# Visual Acceptance Checklist

Use one row per screen/state/viewport/theme evidence set. A meaningful gap keeps the feature below `PRODUCT COMPLETE`.

## Identity and composition

- [ ] Browser render is compared with benchmark evidence, not source code alone.
- [ ] PUTDUK black/gold/space identity is clear without excessive glow, glass or gradient cards.
- [ ] Visual hierarchy matches the screen purpose and has one obvious next action.
- [ ] Production copy contains no engineering/foundation language.
- [ ] All Korean text is live HTML/CSS or reviewed SVG; exact brand spelling is `퍼뜩`.
- [ ] No invented counts, testimonials, balances, progress or social proof.

## Responsive and theme

- [ ] Desktop Dark at approximately 1440 px reviewed.
- [ ] Desktop Light at approximately 1440 px reviewed.
- [ ] Tablet System at approximately 834 px reviewed.
- [ ] Mobile Dark at approximately 390 px reviewed.
- [ ] Mobile Light at approximately 390 px reviewed.
- [ ] 320 px and 200% zoom retain every critical action.
- [ ] Mobile composition is intentionally reprioritized, not merely stacked desktop.

## State quality

- [ ] Loading skeleton follows eventual content and contains no fake value.
- [ ] Empty state explains cause and valid next action.
- [ ] Validation/error preserves safe input and offers recovery.
- [ ] Success names the authoritative result and receipt/evidence.
- [ ] Disabled and unauthorized states are distinct.
- [ ] Offline/reconnect behavior is explicit where applicable.
- [ ] Hover, press, focus and keyboard behavior are visible and coherent.

## Accessibility and motion

- [ ] Semantic landmarks/headings and accessible names are correct.
- [ ] Keyboard order, focus return and modal focus behavior pass.
- [ ] Contrast and non-color status cues pass in both themes.
- [ ] Screen-reader status announcements are concise and truthful.
- [ ] Reduced motion removes nonessential movement without degrading composition.

## Production evidence

- [ ] Real backend/domain state drives the screen.
- [ ] Browser E2E covers the critical route and recovery path.
- [ ] Reviewed screenshots are stored with viewport/theme/state provenance.
- [ ] Visual regression exists where the composition is stable enough.
- [ ] Image format, JS/image weight, LCP/INP/CLS and long-task budgets are reviewed with current evidence.
- [ ] No private Site credential, user financial data, KYC evidence or secret appears in captures/artifacts.

## Explicit rejection gate

Reject generic dashboards, default SaaS or unmodified component-library appearance, placeholder cards, bare forms, raw CRUD tables, random gradients, generic ChatGPT clones, fake/unconnected UI, `coming soon` in place of required V1 UX, and engineering copy visible to consumers.
