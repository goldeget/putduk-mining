import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Row = Record<string, unknown>;
type Snapshot = {
  database: string;
  role: string;
  server_version: string;
  system_identifier: string;
  functions: Row[];
  relations: Row[];
  columns: Row[];
  namespaces: Row[];
};
type Difference = {
  family: string;
  identity: Row;
  status: string;
  rawFields: { field: string; source: unknown; target: unknown }[];
  securityFields: string[];
  representationFields: string[];
  missingEvidenceFields: string[];
  ordinalExplanation: string | null;
};
const require = createRequire(import.meta.url);
const { compareRestoreCatalogs } =
  require("../../scripts/lib/restore-catalog-compare.mjs") as {
    compareRestoreCatalogs(
      source: Snapshot,
      target: Snapshot,
      options?: Record<string, unknown>,
    ): {
      differences: Difference[];
      rawFingerprintComparison: string;
      rawFingerprintDifferences: Row[];
      limitations: string[];
    };
  };

const grant = (
  grantee: string,
  privilege = "USAGE",
  grantor = "supabase_admin",
  grantable = false,
) => ({ grantee, grantor, privilege, grantable });
const snapshot = (parts: Partial<Snapshot> = {}): Snapshot => ({
  database: "postgres",
  role: "postgres",
  server_version: "17.6",
  system_identifier: "7696583684946063397",
  functions: [],
  relations: [],
  columns: [],
  namespaces: [],
  ...parts,
});
const detailsIdentity = {
  database: "postgres",
  role: "postgres",
  system_identifier: "7696583684946063397",
};
const netFunction = (parts: Row = {}): Row => ({
  kind: "function",
  schema: "net",
  name: "http_get",
  args: "url text, params jsonb, headers jsonb, timeout_milliseconds integer",
  owner: "supabase_admin",
  definer: true,
  config_sha256:
    "38e94f3744f486cab1500a001d0f16ad5efa99b64d7bff8ffb1726cc9675803d",
  volatility: "v",
  raw_acl: "{postgres=X/supabase_admin}",
  definition_sha256:
    "a314aa28b0562dc66cc6816ef80ac8572f0f8dad52a2384436aead7f5773e391",
  extension: "pg_net",
  grants: [grant("postgres", "EXECUTE")],
  ...parts,
});
const namespace = (parts: Row = {}): Row => ({
  kind: "namespace",
  schema: "graphql_public",
  owner: "supabase_admin",
  raw_acl: "{supabase_admin=UC/supabase_admin,anon=U/supabase_admin}",
  grants: [
    grant("supabase_admin", "CREATE"),
    grant("supabase_admin"),
    grant("anon"),
  ],
  ...parts,
});
const relation = (parts: Row = {}): Row => ({
  kind: "relation",
  schema: "app_private",
  name: "ai_provider_budget",
  relation_kind: "r",
  owner: "postgres",
  rls: true,
  force_rls: true,
  raw_acl: "{postgres=arwdDxtm/postgres}",
  grants: [grant("postgres", "SELECT", "postgres")],
  ...parts,
});
const column = (parts: Row = {}): Row => ({
  kind: "column",
  schema: "auth",
  relation: "oauth_clients",
  name: "client_name",
  ordinal: 3,
  raw_acl: null,
  grants: null,
  ...parts,
});

describe("read-only restore catalog differences", () => {
  it("keeps the known pg_net definer and search-path loss security-sensitive", () => {
    const source = snapshot({ functions: [netFunction()] });
    const target = snapshot({
      functions: [
        netFunction({
          definer: false,
          config_sha256:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          definition_sha256:
            "7012c5582cd0ab8d38f546af6633ea3c531950fb009f07127b99f8a1640eac1a",
        }),
      ],
    });
    const details = {
      name: "http_get",
      args: source.functions[0]!.args,
      body_sha256: "a".repeat(64),
      search_path_config: ["search_path=net"],
    };
    const result = compareRestoreCatalogs(source, target, {
      sourceDetails: {
        ...detailsIdentity,
        net_functions: [details],
        dropped_columns: null,
      },
      targetDetails: {
        ...detailsIdentity,
        net_functions: [{ ...details, search_path_config: null }],
        dropped_columns: null,
      },
      sourceFingerprint: { functions_sha256: "1".repeat(64) },
      targetFingerprint: { functions_sha256: "2".repeat(64) },
    });
    expect(result.differences[0]!.securityFields).toEqual(
      expect.arrayContaining([
        "definer",
        "config_sha256",
        "search_path_config",
      ]),
    );
    expect(result.differences[0]!.rawFields).not.toContainEqual(
      expect.objectContaining({ field: "body_sha256" }),
    );
    expect(result.rawFingerprintComparison).toBe("DIFFERENT");
    expect(result.rawFingerprintDifferences).toEqual([
      {
        field: "functions_sha256",
        source: "1".repeat(64),
        target: "2".repeat(64),
      },
    ]);
    expect(result).not.toHaveProperty("pass");
    expect(result).not.toHaveProperty("accepted");
  });

  it("reports actual GraphQL USAGE loss even with unchanged schema ownership", () => {
    const source = snapshot({ namespaces: [namespace()] });
    const target = snapshot({
      namespaces: [
        namespace({
          raw_acl: null,
          grants: (namespace().grants as Row[]).slice(0, 2),
        }),
      ],
    });
    const result = compareRestoreCatalogs(source, target);
    expect(result.differences[0]!.securityFields).toContain("grants");
    expect(result.differences[0]!.rawFields).toContainEqual({
      field: "grants",
      source: namespace().grants,
      target: (namespace().grants as Row[]).slice(0, 2),
    });
    expect(result.rawFingerprintComparison).toBe("NOT_PROVIDED");
  });

  it.each([
    ["grantor", grant("anon", "USAGE", "postgres")],
    ["grant option", grant("anon", "USAGE", "supabase_admin", true)],
  ])(
    "does not erase a changed %s when comparing expanded ACLs",
    (_, changed) => {
      const source = snapshot({
        namespaces: [namespace({ grants: [grant("anon")] })],
      });
      const target = snapshot({
        namespaces: [namespace({ grants: [changed] })],
      });
      expect(
        compareRestoreCatalogs(source, target).differences[0]!.securityFields,
      ).toContain("grants");
    },
  );

  it("separates ACL ordering and explicit owner defaults from privilege changes", () => {
    const original = netFunction({
      grants: [grant("postgres", "EXECUTE"), grant("anon", "EXECUTE")],
    });
    const source = snapshot({ functions: [original], relations: [relation()] });
    const target = snapshot({
      functions: [
        {
          ...original,
          grants: [...(original.grants as Row[])].reverse(),
          raw_acl: "reordered-acl",
        },
      ],
      relations: [relation({ raw_acl: null })],
    });
    const result = compareRestoreCatalogs(source, target, {
      sourceFingerprint: { relations_acl_rls_sha256: "1".repeat(64) },
      targetFingerprint: { relations_acl_rls_sha256: "2".repeat(64) },
    });
    expect(result.differences).toHaveLength(2);
    expect(
      result.differences.every((row) => row.securityFields.length === 0),
    ).toBe(true);
    expect(result.differences[0]!.representationFields).toEqual(
      expect.arrayContaining(["raw_acl", "grants"]),
    );
    expect(result.differences[1]!.rawFields).toEqual([
      {
        field: "raw_acl",
        source: "{postgres=arwdDxtm/postgres}",
        target: null,
      },
    ]);
    expect(result.rawFingerprintComparison).toBe("DIFFERENT");
  });

  it("explains column ordinal shifts only when the dropped-column holes account for them", () => {
    const source = snapshot({ columns: [column()] });
    const target = snapshot({ columns: [column({ ordinal: 2 })] });
    const result = compareRestoreCatalogs(source, target, {
      sourceDetails: {
        ...detailsIdentity,
        dropped_columns: [
          { schema: "auth", relation: "oauth_clients", ordinal: 2 },
        ],
      },
      targetDetails: { ...detailsIdentity, dropped_columns: null },
      sourceFingerprint: { columns_acl_sha256: "1".repeat(64) },
      targetFingerprint: { columns_acl_sha256: "2".repeat(64) },
    });
    expect(result.differences[0]!.ordinalExplanation).toBe(
      "DROPPED_COLUMN_HOLES",
    );
    expect(result.differences[0]!.rawFields).toEqual([
      { field: "ordinal", source: 3, target: 2 },
    ]);
    expect(result.rawFingerprintComparison).toBe("DIFFERENT");
    const unexplained = compareRestoreCatalogs(source, target);
    expect(unexplained.differences[0]!.ordinalExplanation).toBeNull();
  });

  it("does not hide a column grant loss behind an explained ordinal shift", () => {
    const source = snapshot({
      columns: [
        column({ grants: [grant("authenticated", "SELECT", "postgres")] }),
      ],
    });
    const target = snapshot({ columns: [column({ ordinal: 2 })] });
    const result = compareRestoreCatalogs(source, target, {
      sourceDetails: {
        ...detailsIdentity,
        dropped_columns: [
          { schema: "auth", relation: "oauth_clients", ordinal: 2 },
        ],
      },
      targetDetails: { ...detailsIdentity, dropped_columns: null },
    });
    expect(result.differences[0]!.ordinalExplanation).toBe(
      "DROPPED_COLUMN_HOLES",
    );
    expect(result.differences[0]!.securityFields).toContain("grants");
  });

  it.each(["functions", "relations", "columns", "namespaces"] as const)(
    "reports missing and unexpected %s instead of comparing only source rows",
    (family) => {
      const rows = {
        functions: netFunction(),
        relations: relation(),
        columns: column(),
        namespaces: namespace(),
      };
      const source = snapshot({ [family]: [rows[family]] });
      const absent = compareRestoreCatalogs(source, snapshot());
      const added = compareRestoreCatalogs(snapshot(), source);
      expect(absent.differences[0]!.status).toBe("MISSING_TARGET");
      expect(added.differences[0]!.status).toBe("ADDED_TARGET");
      expect(absent.differences[0]!.securityFields).toContain("existence");
    },
  );

  it("keeps removed and introduced function signatures as distinct security findings", () => {
    const source = snapshot({ functions: [netFunction()] });
    const target = snapshot({ functions: [netFunction({ args: "url text" })] });
    const result = compareRestoreCatalogs(source, target);
    expect(result.differences.map((row) => row.status)).toEqual([
      "MISSING_TARGET",
      "ADDED_TARGET",
    ]);
    expect(result.differences.map((row) => row.identity.args)).toEqual([
      source.functions[0]!.args,
      "url text",
    ]);
  });

  it.each([
    ["owner", "postgres"],
    ["definition_sha256", "b".repeat(64)],
    ["body_sha256", "c".repeat(64)],
  ])("flags a changed function %s", (field, changed) => {
    const source = snapshot({
      functions: [netFunction({ body_sha256: "a".repeat(64) })],
    });
    const target = snapshot({
      functions: [
        netFunction({ body_sha256: "a".repeat(64), [field]: changed }),
      ],
    });
    expect(
      compareRestoreCatalogs(source, target).differences[0]!.securityFields,
    ).toContain(field);
  });

  it("compares nested objects independent of key order without mutating its inputs", () => {
    const source = snapshot({ namespaces: [namespace()] });
    const target = snapshot({
      namespaces: [
        namespace({
          grants: [
            {
              privilege: "CREATE",
              grantable: false,
              grantor: "supabase_admin",
              grantee: "supabase_admin",
            },
            {
              privilege: "USAGE",
              grantable: false,
              grantor: "supabase_admin",
              grantee: "supabase_admin",
            },
            {
              privilege: "USAGE",
              grantable: false,
              grantor: "supabase_admin",
              grantee: "anon",
            },
          ],
        }),
      ],
    });
    const before = JSON.stringify([source, target]);
    expect(compareRestoreCatalogs(source, target).differences).toEqual([]);
    expect(JSON.stringify([source, target])).toBe(before);
  });

  it("marks an unobserved body hash as missing evidence instead of a body change or equality", () => {
    const source = snapshot({
      functions: [netFunction({ body_sha256: "d".repeat(64) })],
    });
    const target = snapshot({ functions: [netFunction()] });
    const result = compareRestoreCatalogs(source, target);
    expect(result.differences[0]!.missingEvidenceFields).toContain(
      "body_sha256",
    );
    expect(result.differences[0]!.securityFields).not.toContain("body_sha256");
    expect(result.differences[0]!.rawFields).toContainEqual({
      field: "body_sha256",
      source: "d".repeat(64),
      target: undefined,
      sourcePresent: true,
      targetPresent: false,
    });
  });

  it("rejects empty fingerprint evidence and security fields with invalid types", () => {
    expect(() =>
      compareRestoreCatalogs(snapshot(), snapshot(), {
        sourceFingerprint: {},
        targetFingerprint: {},
      }),
    ).toThrow(/fingerprint/i);
    expect(() =>
      compareRestoreCatalogs(
        snapshot({ functions: [netFunction({ definer: "false" })] }),
        snapshot(),
      ),
    ).toThrow(/definer/i);
    expect(() =>
      compareRestoreCatalogs(
        snapshot({ namespaces: [namespace({ grants: undefined })] }),
        snapshot(),
      ),
    ).toThrow(/grants/i);
  });

  it("rejects missing observation identity and malformed supplemental function metadata", () => {
    expect(() =>
      compareRestoreCatalogs(
        { ...snapshot(), database: undefined } as unknown as Snapshot,
        snapshot(),
      ),
    ).toThrow(/database/i);
    expect(() =>
      compareRestoreCatalogs(
        snapshot({ functions: [netFunction()] }),
        snapshot(),
        {
          sourceDetails: { ...detailsIdentity, net_functions: [null] },
        },
      ),
    ).toThrow(/function details/i);
    expect(() =>
      compareRestoreCatalogs(
        snapshot({ functions: [netFunction()] }),
        snapshot(),
        {
          sourceDetails: {
            ...detailsIdentity,
            net_functions: [
              {
                name: "http_get",
                args: netFunction().args,
                body_sha256: "invalid",
              },
            ],
          },
        },
      ),
    ).toThrow(/SHA256/i);
  });

  it("rejects impossible duplicate live ordinals and dropped holes overlapping a live column", () => {
    const duplicate = snapshot({
      columns: [column(), column({ name: "other_column" })],
    });
    expect(() => compareRestoreCatalogs(duplicate, snapshot())).toThrow(
      /ordinal/i,
    );
    expect(() =>
      compareRestoreCatalogs(snapshot({ columns: [column()] }), snapshot(), {
        sourceDetails: {
          ...detailsIdentity,
          dropped_columns: [
            { schema: "auth", relation: "oauth_clients", ordinal: 3 },
          ],
        },
      }),
    ).toThrow(/overlap/i);
    expect(() =>
      compareRestoreCatalogs(
        snapshot({ functions: [netFunction({ volatility: undefined })] }),
        snapshot(),
      ),
    ).toThrow(/undefined/i);
  });

  it.each([undefined, null, "", "not-a-digest"])(
    "rejects an unobserved or malformed fingerprint digest %s",
    (invalid) => {
      expect(() =>
        compareRestoreCatalogs(snapshot(), snapshot(), {
          sourceFingerprint: { functions_sha256: invalid },
          targetFingerprint: { functions_sha256: "1".repeat(64) },
        }),
      ).toThrow(/fingerprint/i);
    },
  );

  it("binds fingerprint identity to its own observation without requiring the same restore database or cluster", () => {
    expect(() =>
      compareRestoreCatalogs(snapshot(), snapshot(), {
        sourceFingerprint: {
          database: "wrong-source",
          functions_sha256: "1".repeat(64),
        },
        targetFingerprint: { functions_sha256: "1".repeat(64) },
      }),
    ).toThrow(/fingerprint database/i);
    const target = snapshot({
      database: "restore",
      system_identifier: "123456789",
    });
    const result = compareRestoreCatalogs(snapshot(), target, {
      sourceFingerprint: {
        database: "postgres",
        system_identifier: "7696583684946063397",
        functions_sha256: "1".repeat(64),
      },
      targetFingerprint: {
        database: "restore",
        system_identifier: "123456789",
        functions_sha256: "1".repeat(64),
      },
    });
    expect(result.rawFingerprintDifferences).toEqual([
      {
        field: "system_identifier",
        source: "7696583684946063397",
        target: "123456789",
      },
    ]);
    expect(result.rawFingerprintComparison).toBe("DIFFERENT");
  });

  it("fails closed for duplicate identities, incomplete arrays and one-sided fingerprint evidence", () => {
    expect(() =>
      compareRestoreCatalogs(
        snapshot({ functions: [netFunction(), netFunction()] }),
        snapshot(),
      ),
    ).toThrow(/duplicate/i);
    expect(() =>
      compareRestoreCatalogs(
        { ...snapshot(), namespaces: undefined } as unknown as Snapshot,
        snapshot(),
      ),
    ).toThrow(/namespaces/i);
    expect(() =>
      compareRestoreCatalogs(snapshot(), snapshot(), { sourceFingerprint: {} }),
    ).toThrow(/fingerprint/i);
  });
});
