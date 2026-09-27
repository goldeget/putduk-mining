# Responsive Specification

Canonical review widths are approximately `390 px`, `834 px` and `1440 px`. Implementation must remain usable from `320 px` upward and at 200% text zoom; these widths are evidence points, not device sniffing rules.

## Layout ranges

- compact: `320–599 px`;
- large compact / small tablet: `600–767 px`;
- tablet: `768–1099 px`;
- desktop: `1100 px+`;
- wide desktop: cap primary reading and action regions; do not stretch financial lines across the viewport.

## Compact behavior

- Keep brand, current state and one primary action above the fold where practical.
- Replace side rails with an intentional bottom navigation or labelled menu.
- Use full-width cards only when they represent one coherent decision; avoid a long stack of desktop widgets.
- Preserve at least `16 px` edge space and safe-area insets; financial inputs and primary actions use touch targets of at least `44 px`.
- Crop cinematic imagery with a specified focal point. Do not scale the whole desktop canvas to unreadable size.
- Tables become labelled records or controlled horizontal evidence views; never hide required status columns.

## Tablet behavior

- Use two-column compositions when both columns remain independently readable.
- Collapse secondary navigation before shrinking primary information.
- Keep mining stage, money summary and operator attention regions visually dominant.
- Modals remain bounded and keyboard-safe; dense admin detail may become anchored sections.

## Desktop behavior

- Use asymmetric, deliberate composition rather than uniform card grids.
- Public hero copy, Earth/mining visual and trust proof form one visual sequence.
- Product and admin rails have distinct bundles and identities.
- Long activity histories use readable maximum widths, sticky contextual summaries only when they do not obscure content.

## Typography and spacing

- Heading wrapping is authored for Korean; avoid orphaned particles and single-character final lines.
- Money uses tabular numerals and never relies on font size alone for available/held distinction.
- Spacing follows the token scale; adjacent elements are grouped by purpose, not by identical card padding.
- Dynamic content must tolerate at least 30% longer Korean labels and browser text scaling.

## Theme behavior

System is a preference, not a third visual palette. Light and Dark share hierarchy and component geometry. Light uses mineral paper/ink and restrained gold; Dark uses black/charcoal and warm metallic highlights. Asset variants and contrast are reviewed independently.
