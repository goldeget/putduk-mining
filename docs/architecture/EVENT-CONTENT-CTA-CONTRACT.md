# Event content CTA contract

The protected CMS payload and authenticated member event projection use
`CONTENT_CTA_ROUTES` from `domain/content/contract.ts` as the same exact route
allowlist. A published event's full body must remain readable when its approved
CTA opens `/status`, `/changelog` or `/faq`. These existing public help routes
are backed by `TRUST_DOCUMENTS` and the trust document catch-all page.

Content navigation and notification delivery navigation have separate contracts.
The notification deep-link validator remains unchanged. Adding a route to the
content allowlist does not authorize that route for notification delivery, a
domain command or an external URL. Conversely, notification-only destinations
such as `/ai` or `/products/allocation` are not automatically event content CTAs.

The member content DTO accepts exact approved routes only. It rejects external
and administrator URLs, protocol-relative links, executable schemes, command
paths, query strings, fragments, encoded routes and unknown paths. This read
contract does not change event participation, eligibility, rewards, publication
authority, audience, RLS or UI layout.

The optional `participation_mode` read field preserves a server-projected
`GUIDE` or `JOIN` value. Older projections without that field remain compatible;
the DTO does not invent a default. The database owns the guide participation
guard. This change does not alter `canJoinMemberEvent` or existing UI callers;
guide presentation integration remains pending.

`tests/unit/event-content-cta-contract.test.ts` covers the public help regression,
existing member navigation, unsafe destinations and notification isolation.
Passing these tests proves the scoped DTO contract; it does not prove browser
rendering, original campaign registration or production publication.
