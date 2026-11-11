import {
  PUBLIC_FACTS,
  TRUST_CONTENT_VERSION,
  TRUST_DOCUMENTS,
  TRUST_LAST_UPDATED,
} from "@/lib/workroom/public-content";

export function GET() {
  const lines = [
    "# WORKROOM",
    "",
    "Official public information for WORKROOM.",
    `Content version: ${TRUST_CONTENT_VERSION}`,
    `Last updated: ${TRUST_LAST_UPDATED}`,
    "Canonical origin: https://workroom.putduk.com",
    "",
    "## Official facts",
    ...PUBLIC_FACTS.map(
      (fact) => `- ${fact.key}: ${fact.value} — ${fact.description}`,
    ),
    "",
    "## Public documents",
    ...TRUST_DOCUMENTS.map(
      (document) =>
        `- https://workroom.putduk.com${document.path} — ${document.summary}`,
    ),
    "",
    "## Machine-readable facts",
    "- https://workroom.putduk.com/api/v1/public/facts",
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
