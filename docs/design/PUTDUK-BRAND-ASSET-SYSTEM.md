# PUTDUK Brand Asset System

Product composition and interaction are governed by `docs/design/visual-lab/` benchmark `visual-lab-2026.09.27-v1`. That benchmark may select or crop the versioned assets documented here, but it is not an asset source, runtime dependency, economic source or backend truth. Reference captures stay under `docs/design/visual-lab/references/`; production assets stay in the manifest-controlled runtime paths below.

Status: **CANONICAL / IMPLEMENTED FOUNDATION**

Manifest: `public/brand/assets.manifest.json`

Asset version: `2026.09.27-v1`

## 1. Source and runtime boundary

Canonical visual references live only in `docs/design/visual-references/`. They are evidence of art direction and are not application assets. Generated lossless source masters live in `docs/design/generated-masters/`; they are build inputs, not publicly served files.

Runtime assets live under:

```text
public/brand/
├── favicon/
├── logo/
├── mascot/
├── notification/
├── og/
├── pwa/
├── social/
├── splash/
├── symbol/
├── wordmark/
└── worlds/

public/ranks/
├── rank-01/
├── rank-02/
├── rank-03/
├── rank-04/
├── rank-05/
└── rank-06/
```

No runtime component may import a canonical reference file. No generated raster may supply production text.

## 2. Provenance

- The two canonical mockups were supplied by the product owner on 2026-09-27.
- The mascot, Earth-world background and six neutral rank planets were generated specifically for this repository from those references using the built-in image-generation workflow.
- Generation explicitly prohibited typography, letters, numbers, logos, watermarks and UI chrome.
- SVG symbols, wordmarks and lockups were authored as repository-native vectors. The Korean wordmark contains the reviewed text `퍼뜩`.
- Raster derivatives are deterministic outputs of `scripts/build-brand-assets.py` from the approved masters.
- Source-master hashes and roles are recorded in `docs/design/generated-masters/README.md`.

Any replacement master requires a new asset version, a review record and a regenerated manifest. Do not silently overwrite a versioned master.

## 3. Asset roles

| Family | Intended use | Delivery rule |
| --- | --- | --- |
| `symbol` | Navigation, compact identity, UI chrome | SVG; select light/dark variant by surface |
| `wordmark` | Branded headers and approved lockups | SVG; preserve clear space and exact Korean spelling |
| `logo` | Full identity lockup | SVG; do not place below minimum legibility size |
| `mascot` | Onboarding, guidance, celebration, selected empty states | Transparent AVIF first, WebP fallback; responsive `srcset` |
| `worlds` | Hero/mining atmospheric backgrounds | AVIF first, WebP fallback; responsive width; decorative alt when copy conveys meaning |
| `pwa` | Install icons | PNG 192/512 plus 512 maskable; never use a transparent unsafe-zone composition |
| `favicon` | Browser identity | SVG + PNG + ICO fallback |
| `splash` | Mobile/tablet/desktop launch and campaign surfaces | AVIF/WebP; do not preload all breakpoints |
| `notification` | Push icon/badge | Monochrome transparent badge; platform-safe |
| `og` / `social` | Social preview bases | Raster art only; production copy is overlaid by the renderer |
| `ranks` | Rank/world progression | Neutral numeric IDs; names and benefits come from versioned data |

## 4. Responsive delivery

Use `<picture>` with AVIF and WebP sources. Select only the sizes the layout can render. Example:

```html
<picture>
  <source
    type="image/avif"
    srcset="/brand/mascot/putduk-miner-384-v1.avif 384w, /brand/mascot/putduk-miner-768-v1.avif 768w"
  />
  <source
    type="image/webp"
    srcset="/brand/mascot/putduk-miner-384-v1.webp 384w, /brand/mascot/putduk-miner-768-v1.webp 768w"
  />
  <img src="/brand/mascot/putduk-miner-384-v1.webp" alt="금빛 광부 헬멧과 새싹을 쓴 퍼뜩 마스코트" />
</picture>
```

- Preload only a measured LCP candidate.
- Lazy-load below-the-fold world, rank and campaign art.
- Declare intrinsic dimensions or aspect ratio to prevent layout shift.
- Do not ship master PNG files to ordinary UI routes.
- Use CSS/SVG for simple marks and state icons.
- Three-dimensional scenes require separate LOD and texture budgets; the current raster system is the complete fallback.

## 5. Theme variants

- `*-dark-*`: optimized for carbon/black surfaces.
- `*-light-*`: outlined or surfaced for warm ivory backgrounds.
- no theme suffix or `theme: system`: safe in both themes or selected through semantic surface rules.
- `maskable`: contains the complete mark inside the platform safe zone.

System mode resolves to the operating-system preference. A user override may select Light or Dark without changing the asset URL semantics recorded here.

## 6. Accessibility

- Informative mascot/rank art uses the Korean alt text in the manifest or a more specific contextual equivalent.
- Decorative atmosphere uses `alt=""` and must not be the only source of information.
- Rank level, name, requirements and state must be adjacent real text.
- Motion/video alternatives must expose the same state and action.
- Gold-on-ivory and gold-on-black combinations require measured text contrast; gold is not automatically a valid body-text color.

## 7. Versioning and integrity

`public/brand/assets.manifest.json` records:

- schema and asset version;
- canonical path;
- byte length and SHA-256;
- MIME type;
- dimensions where applicable;
- theme/purpose metadata;
- accessible alternative text.

Run:

```text
pnpm assets:verify
```

The verifier checks reference hashes, every manifest digest, required PWA files, all six rank families and the exact Korean wordmark. `pnpm verify` includes this gate.

## 8. Change procedure

1. Record the proposed visual/product reason.
2. Confirm that the change does not introduce generated copy or unapproved product claims.
3. Save a new versioned master; never mutate the canonical reference silently.
4. Run the derivative builder using its pinned workspace dependencies.
5. Review dark/light/system rendering and representative mobile/tablet/desktop crops.
6. Run asset verification, browser QA and performance budgets.
7. Update the manifest/version and release notes.
8. Retain the prior version until deployed references and caches are safely retired.

## 9. Rank naming boundary

The supplied rank mockup contains more named visual examples than the requested production directory contract. V1 therefore ships exactly six neutral asset families (`rank-01`…`rank-06`). The architecture does not infer or copy generated rank names, benefits, thresholds or rewards. Product-owned rank configuration will bind real Korean names to these IDs through reviewed, versioned data.
