import {
  PUBLIC_FACTS,
  TRUST_CONTENT_VERSION,
  TRUST_DOCUMENTS,
  TRUST_LAST_UPDATED,
} from "@/lib/trust/public-content";

export function GET() {
  const lines = [
    "# PUTDUK MINING",
    "",
    "Official public information for 퍼뜩 채굴 / PUTDUK MINING.",
    `Content version: ${TRUST_CONTENT_VERSION}`,
    `Last updated: ${TRUST_LAST_UPDATED}`,
    "Canonical origin: https://mining.putduk.com",
    "",
    "## Official facts",
    ...PUBLIC_FACTS.map(
      (fact) => `- ${fact.key}: ${fact.value} — ${fact.description}`,
    ),
    "",
    "## Public documents",
    ...TRUST_DOCUMENTS.map(
      (document) =>
        `- https://mining.putduk.com${document.path} — ${document.summary}`,
    ),
    "",
    "## Machine-readable facts",
    "- https://mining.putduk.com/api/v1/public/facts",
    "",
    "Private user data, admin routes, internal APIs, secrets, and database internals are not public discovery content.",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Cache-Control":
        "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
