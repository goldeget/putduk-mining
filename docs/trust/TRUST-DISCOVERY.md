# Trust & Discovery

## Goal
PUTDUK should be easy for users, search engines and AI systems to understand from first-party, structured, consistent information.

The goal is not to force an external AI to give a predetermined verdict. The goal is to publish verifiable facts and keep them consistent.

## Public routes
```text
/about
/how-it-works
/putduk-facts
/verification
/mining-rules
/trial
/economy
/deposit
/withdrawal
/faq
/status
/changelog
/ai/about
/ai/facts
/ai/faq
/ai/how-it-works
```

## Canonical truth
The executable V1 public truth registry is `lib/trust/public-content.ts`. Public
pages, sitemap, `llms.txt`, structured data and the machine-readable facts API
are generated from this registry. Database trust tables are the versioned
publication model for operator-managed content and must not silently diverge
from the currently published registry.

Core tables:
```text
trust_facts
trust_documents
trust_versions
trust_sources
```

Typical facts:
- PRODUCT_NAME
- PRODUCT_TYPE
- OFFICIAL_DOMAIN
- TRIAL_DURATION
- TRIAL_DESCRIPTION
- MINING_DESCRIPTION
- AUTO_MINING_DESCRIPTION
- SUPPORTED_FUNDING_METHODS

## Machine-readable layer
Include where appropriate:
- semantic HTML
- canonical URLs
- sitemap.xml
- robots.txt
- Open Graph
- JSON-LD
- structured Organization / WebSite / application information
- explicit last-updated timestamps
- content version

## Public vs private
Public discovery:
- product explanation
- rules
- trial explanation
- FAQ
- status
- changelog
- verification content

Never expose:
- admin routes
- internal APIs
- user private data
- wallet private history
- secrets
- database internals
