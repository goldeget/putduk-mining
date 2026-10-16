/**
 * Compare sanitized, read-only catalog snapshots. This module performs no I/O.
 * Raw fingerprint observations and semantic explanations remain independent:
 * an explanation never turns a raw mismatch into restore acceptance.
 */
const FAMILIES = ["functions", "relations", "columns", "namespaces"];
const SECURITY_FIELDS = new Set([
  "owner",
  "definer",
  "config",
  "config_sha256",
  "search_path_config",
  "definition_sha256",
  "body_sha256",
  "binary_sha256",
  "volatility",
  "extension",
  "rls",
  "force_rls",
  "relation_kind",
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function text(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string`);
  }
}

function hash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a SHA256 hex string`);
  }
}

function functionSecurity(row, label) {
  for (const field of [
    "config_sha256",
    "definition_sha256",
    "body_sha256",
    "binary_sha256",
  ]) {
    if (Object.hasOwn(row, field)) hash(row[field], `${label}.${field}`);
  }
  if (Object.hasOwn(row, "definer") && typeof row.definer !== "boolean") {
    throw new TypeError(`${label}.definer must be a boolean`);
  }
  if (
    Object.hasOwn(row, "search_path_config") &&
    row.search_path_config !== null &&
    (!Array.isArray(row.search_path_config) ||
      row.search_path_config.some((value) => typeof value !== "string"))
  ) {
    throw new TypeError(
      `${label}.search_path_config must be an array of strings or null`,
    );
  }
}

function stable(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(normalize));
  return JSON.stringify(normalize(value));
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalize(value[key])]),
    );
  }
  return value;
}

function identity(family, row) {
  const result = { schema: row.schema };
  if (family === "columns") result.relation = row.relation;
  if (family !== "namespaces") result.name = row.name;
  if (family === "functions") result.args = row.args;
  return result;
}

function grantIdentity(grant) {
  return [grant.grantor, grant.grantee, grant.privilege, grant.grantable];
}

function normalizedGrants(grants) {
  // Snapshot queries already expand default ACLs. NULL here means no grants;
  // this helper never infers owner defaults from raw ACL text.
  return (grants ?? []).map(grantIdentity).map(stable).sort();
}

function validateRow(family, row, label) {
  object(row, label);
  for (const [field, value] of Object.entries(row)) {
    if (value === undefined)
      throw new TypeError(`${label}.${field} is undefined`);
  }
  const fields = ["schema", "raw_acl", "grants"];
  if (family !== "namespaces") fields.push("name");
  if (family === "functions") {
    fields.push(
      "args",
      "owner",
      "definer",
      "config_sha256",
      "definition_sha256",
    );
  }
  if (family === "relations") fields.push("owner", "rls", "force_rls");
  if (family === "namespaces") fields.push("owner");
  if (family === "columns") fields.push("relation", "ordinal");
  for (const field of fields) {
    if (!Object.hasOwn(row, field) || row[field] === undefined) {
      throw new TypeError(`${label} missing ${field}`);
    }
  }
  for (const value of Object.values(identity(family, row))) {
    if (typeof value !== "string")
      throw new TypeError(`${label} identity must contain strings`);
  }
  text(row.schema, `${label}.schema`);
  if (family !== "namespaces") text(row.name, `${label}.name`);
  if (family === "columns") text(row.relation, `${label}.relation`);
  if (Object.hasOwn(row, "owner")) text(row.owner, `${label}.owner`);
  if (family === "functions") functionSecurity(row, label);
  if (family === "relations") {
    for (const field of ["rls", "force_rls"]) {
      if (typeof row[field] !== "boolean")
        throw new TypeError(`${label}.${field} must be a boolean`);
    }
  }
  if (row.raw_acl !== null && typeof row.raw_acl !== "string") {
    throw new TypeError(`${label}.raw_acl must be a string or null`);
  }
  if (
    family === "columns" &&
    (!Number.isInteger(row.ordinal) || row.ordinal < 1)
  ) {
    throw new TypeError(`${label} ordinal must be a positive integer`);
  }
  if (row.grants !== null && !Array.isArray(row.grants)) {
    throw new TypeError(`${label} grants must be expanded ACL rows or null`);
  }
  const grants = new Set();
  for (const grant of row.grants ?? []) {
    object(grant, `${label} grant`);
    if (
      [grant.grantor, grant.grantee, grant.privilege].some(
        (value) => typeof value !== "string",
      ) ||
      typeof grant.grantable !== "boolean"
    ) {
      throw new TypeError(
        `${label} grant requires grantor, grantee, privilege and grantable`,
      );
    }
    const key = stable(grantIdentity(grant));
    if (grants.has(key))
      throw new TypeError(`${label} duplicate expanded grant`);
    grants.add(key);
  }
}

function indexSnapshot(snapshot, label, details) {
  object(snapshot, label);
  for (const field of [
    "database",
    "role",
    "server_version",
    "system_identifier",
  ]) {
    text(snapshot[field], `${label}.${field}`);
  }
  const supplements = new Map();
  if (details !== undefined) {
    object(details, `${label} details`);
    for (const [field, value] of Object.entries(details)) {
      if (value === undefined)
        throw new TypeError(`${label} details.${field} is undefined`);
    }
    for (const field of ["database", "role", "system_identifier"]) {
      text(details[field], `${label} details.${field}`);
      if (details[field] !== snapshot[field]) {
        throw new TypeError(`${label} details ${field} differs from snapshot`);
      }
    }
    if (
      Object.hasOwn(details, "server_version") &&
      details.server_version !== snapshot.server_version
    ) {
      throw new TypeError(
        `${label} details server_version differs from snapshot`,
      );
    }
    if (
      details.net_functions !== undefined &&
      !Array.isArray(details.net_functions)
    ) {
      throw new TypeError(`${label} details net_functions must be an array`);
    }
    for (const row of details.net_functions ?? []) {
      object(row, `${label} function details`);
      text(row.name, `${label} function details.name`);
      if (typeof row.args !== "string")
        throw new TypeError(`${label} function details.args must be a string`);
      functionSecurity(row, `${label} function details`);
      const key = stable(identity("functions", { ...row, schema: "net" }));
      if (supplements.has(key))
        throw new TypeError(`${label} duplicate function details`);
      supplements.set(key, row);
    }
  }
  const result = {};
  for (const family of FAMILIES) {
    if (!Array.isArray(snapshot[family])) {
      throw new TypeError(`${label}.${family} must be an array`);
    }
    const rows = new Map();
    const liveOrdinals = new Set();
    for (const original of snapshot[family]) {
      validateRow(family, original, `${label}.${family}`);
      if (family === "columns") {
        const ordinalKey = stable([
          original.schema,
          original.relation,
          original.ordinal,
        ]);
        if (liveOrdinals.has(ordinalKey))
          throw new TypeError(`${label} duplicate live column ordinal`);
        liveOrdinals.add(ordinalKey);
      }
      const row = { ...original };
      if (family === "functions" && row.schema === "net") {
        const detail = supplements.get(stable(identity(family, row)));
        if (detail) {
          for (const field of ["owner", "definer", "config_sha256"]) {
            if (Object.hasOwn(detail, field) && detail[field] !== row[field]) {
              throw new TypeError(
                `${label} function details ${field} differs from snapshot`,
              );
            }
          }
          for (const field of [
            "body_sha256",
            "binary_sha256",
            "search_path_config",
          ]) {
            if (Object.hasOwn(detail, field)) {
              if (
                Object.hasOwn(row, field) &&
                stable(row[field]) !== stable(detail[field])
              ) {
                throw new TypeError(
                  `${label} function details ${field} differs from snapshot`,
                );
              }
              row[field] = detail[field];
            }
          }
        }
      }
      const key = stable(identity(family, row));
      if (rows.has(key))
        throw new TypeError(`${label}.${family} duplicate identity`);
      rows.set(key, row);
    }
    result[family] = rows;
  }
  for (const key of supplements.keys()) {
    if (!result.functions.has(key))
      throw new TypeError(`${label} function details missing catalog identity`);
  }
  return result;
}

function droppedColumns(details, label, liveColumns) {
  if (!details || !Object.hasOwn(details, "dropped_columns")) return null;
  const rows = details.dropped_columns ?? [];
  if (!Array.isArray(rows))
    throw new TypeError(`${label} dropped_columns must be an array or null`);
  const seen = new Set();
  for (const row of rows) {
    object(row, `${label} dropped column`);
    if (
      typeof row.schema !== "string" ||
      typeof row.relation !== "string" ||
      !Number.isInteger(row.ordinal) ||
      row.ordinal < 1
    ) {
      throw new TypeError(`${label} invalid dropped column identity`);
    }
    const key = stable([row.schema, row.relation, row.ordinal]);
    if (seen.has(key)) throw new TypeError(`${label} duplicate dropped column`);
    for (const live of liveColumns.values()) {
      if (
        live.schema === row.schema &&
        live.relation === row.relation &&
        live.ordinal === row.ordinal
      ) {
        throw new TypeError(`${label} dropped column overlaps a live ordinal`);
      }
    }
    seen.add(key);
  }
  return rows;
}

function ordinalExplanation(source, target, sourceHoles, targetHoles) {
  if (sourceHoles === null || targetHoles === null) return null;
  const preceding = (rows, column) =>
    rows.filter(
      (hole) =>
        hole.schema === column.schema &&
        hole.relation === column.relation &&
        hole.ordinal < column.ordinal,
    ).length;
  const sourceBefore = preceding(sourceHoles, source);
  const targetBefore = preceding(targetHoles, target);
  return sourceBefore !== targetBefore &&
    source.ordinal - sourceBefore === target.ordinal - targetBefore
    ? "DROPPED_COLUMN_HOLES"
    : null;
}

function rawFingerprints(source, target, sourceSnapshot, targetSnapshot) {
  if (source === undefined && target === undefined) {
    return {
      rawFingerprintComparison: "NOT_PROVIDED",
      rawFingerprintDifferences: [],
    };
  }
  object(source, "source fingerprint");
  object(target, "target fingerprint");
  for (const [value, snapshot, label] of [
    [source, sourceSnapshot, "source"],
    [target, targetSnapshot, "target"],
  ]) {
    if (!Object.keys(value).some((field) => field.endsWith("_sha256"))) {
      throw new TypeError(
        `${label} fingerprint must contain observed SHA256 components`,
      );
    }
    for (const [field, component] of Object.entries(value)) {
      if (component === undefined)
        throw new TypeError(`${label} fingerprint.${field} is undefined`);
      if (field.endsWith("_sha256"))
        hash(component, `${label} fingerprint.${field}`);
    }
    for (const field of [
      "database",
      "role",
      "server_version",
      "system_identifier",
    ]) {
      if (Object.hasOwn(value, field) && value[field] !== snapshot[field]) {
        throw new TypeError(
          `${label} fingerprint ${field} differs from snapshot`,
        );
      }
    }
  }
  const differences = [];
  for (const field of [
    ...new Set([...Object.keys(source), ...Object.keys(target)]),
  ].sort()) {
    // Database names necessarily differ for a restore into a new target.
    // Every other recorded fingerprint component remains an independent check.
    if (
      field !== "database" &&
      stable(source[field]) !== stable(target[field])
    ) {
      const sourcePresent = Object.hasOwn(source, field);
      const targetPresent = Object.hasOwn(target, field);
      differences.push({
        field,
        source: source[field],
        target: target[field],
        ...(!sourcePresent || !targetPresent
          ? { sourcePresent, targetPresent }
          : {}),
      });
    }
  }
  return {
    rawFingerprintComparison: differences.length ? "DIFFERENT" : "IDENTICAL",
    rawFingerprintDifferences: differences,
  };
}

/**
 * Options use the existing fingerprint and mechanism snapshot shapes.
 * No result field signifies acceptance, authorization or data equivalence.
 */
export function compareRestoreCatalogs(source, target, options = {}) {
  object(options, "options");
  const sourceRows = indexSnapshot(source, "source", options.sourceDetails);
  const targetRows = indexSnapshot(target, "target", options.targetDetails);
  const sourceHoles = droppedColumns(
    options.sourceDetails,
    "source details",
    sourceRows.columns,
  );
  const targetHoles = droppedColumns(
    options.targetDetails,
    "target details",
    targetRows.columns,
  );
  const differences = [];
  for (const family of FAMILIES) {
    const keys = new Set([
      ...sourceRows[family].keys(),
      ...targetRows[family].keys(),
    ]);
    for (const key of keys) {
      const before = sourceRows[family].get(key);
      const after = targetRows[family].get(key);
      if (!before || !after) {
        differences.push({
          family,
          identity: identity(family, before ?? after),
          status: before ? "MISSING_TARGET" : "ADDED_TARGET",
          rawFields: [
            { field: "object", source: before ?? null, target: after ?? null },
          ],
          securityFields: ["existence"],
          representationFields: [],
          missingEvidenceFields: [],
          ordinalExplanation: null,
        });
        continue;
      }
      const rawFields = [];
      const securityFields = [];
      const representationFields = [];
      const missingEvidenceFields = [];
      const grantsEqual =
        stable(normalizedGrants(before.grants)) ===
        stable(normalizedGrants(after.grants));
      for (const field of [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
      ].sort()) {
        if (stable(before[field]) === stable(after[field])) continue;
        const sourcePresent = Object.hasOwn(before, field);
        const targetPresent = Object.hasOwn(after, field);
        rawFields.push({
          field,
          source: before[field],
          target: after[field],
          ...(!sourcePresent || !targetPresent
            ? { sourcePresent, targetPresent }
            : {}),
        });
        if (!sourcePresent || !targetPresent) {
          missingEvidenceFields.push(field);
          continue;
        }
        if ((field === "raw_acl" || field === "grants") && grantsEqual) {
          representationFields.push(field);
        } else if (
          SECURITY_FIELDS.has(field) ||
          field === "grants" ||
          field === "raw_acl"
        ) {
          securityFields.push(field);
        }
      }
      if (rawFields.length) {
        differences.push({
          family,
          identity: identity(family, before),
          status: "CHANGED",
          rawFields,
          securityFields,
          representationFields,
          missingEvidenceFields,
          ordinalExplanation:
            family === "columns" && before.ordinal !== after.ordinal
              ? ordinalExplanation(before, after, sourceHoles, targetHoles)
              : null,
        });
      }
    }
  }
  return {
    ...rawFingerprints(
      options.sourceFingerprint,
      options.targetFingerprint,
      source,
      target,
    ),
    differences,
    limitations: [
      "CATALOG_METADATA_ONLY_NOT_DATA_OR_OPERATIONAL_RESTORE_ACCEPTANCE",
      "RAW_FINGERPRINT_DIFFERENCES_RETAINED_INDEPENDENTLY_OF_EXPLANATIONS",
      "UNOBSERVED_FUNCTION_BODIES_OR_SETTINGS_ARE_NOT_INFERRED_EQUAL",
    ],
  };
}
