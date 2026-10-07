# PUTDUK Brand Asset System

Product composition and interaction are governed by `docs/design/visual-lab/` benchmark `visual-lab-2026.09.27-v1`. That benchmark may select or crop the versioned assets documented here, but it is not an asset source, runtime dependency, economic source or backend truth. Reference captures stay under `docs/design/visual-lab/references/`; production assets stay in the manifest-controlled runtime paths below.

Status: **CANONICAL / IMPLEMENTED FOUNDATION**

Manifest: `public/brand/assets.manifest.json`

Runtime manifest snapshot: `2026.10.06-v10` — 152 assets: the preserved 84-entry
`2026.09.27-v1` set plus four approved AI help face derivatives, eight clean
semiconductor scene derivatives, eight global pavilion derivatives and eight
light semiconductor derivatives, eight HOME semiconductor tower derivatives and
eight Light HOME wafer derivatives and eight neutral GOLD category derivatives.
Eight Dark desktop and eight Light desktop derivatives extend this set.
The complete prior 136-entry set and reviewed Dark desktop pack are preserved.
Visual Lab remains `visual-lab-2026.09.27-v1`; it is a separate benchmark version.

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
├── scenes/semiconductor-memory/
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
- The owner approved the complete AI help face and normal-flow help row on
  2026-10-03. `scripts/build-ai-help-assets.py` supplies only its 128/256 AVIF/WebP
  derivatives. It preserves the full square composition with premultiplied-alpha
  resampling; this approval does not include the semiconductor scene or economy.
- A separate 2026-10-03 owner delegation selected the existing clean semiconductor
  master for app use. `scripts/build-semiconductor-scene-assets.py` preserves its
  complete RGB 1539×1022 composition with width-only downsampling. AVIF uses
  quality94/4:4:4; lossless WebP preserves each resized pixel. This pack does not
  approve new product mappings, other scene families or economic runtime.
- Source-master hashes and roles are recorded in `docs/design/generated-masters/README.md`.

Any replacement master requires a new asset version, a review record and a regenerated manifest. Do not silently overwrite a versioned master.

## 3. Asset roles

| Family | Intended use | Delivery rule |
| --- | --- | --- |
| `symbol` | Navigation, compact identity, UI chrome | SVG; select light/dark variant by surface |
| `wordmark` | Branded headers and approved lockups | SVG; preserve clear space and exact Korean spelling |
| `logo` | Full identity lockup | SVG; do not place below minimum legibility size |
| `mascot` | Onboarding, guidance, celebration, selected empty states | Transparent AVIF first, WebP fallback; responsive `srcset` |
| `mascot/putduk-ai-help-face-{128,256}-v1` | Approved `AI 도움` launcher and panel identity | Whole-face AVIF/WebP; `object-fit: contain`; preserve source hash and narrow review scope |
| `worlds` | Hero/mining atmospheric backgrounds | AVIF first, WebP fallback; responsive width; decorative alt when copy conveys meaning |
| `scenes/semiconductor-memory` | Explicit approved default mining backdrop and approved memory family | Complete 640/960/1280/1539 AVIF plus lossless WebP; immutable clean-master hash, no runtime PNG |
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
- The AI help face source is
  `docs/design/generated-masters/ai-help-face-2026-10-03/putduk-ai-help-face-master-v1.png`,
  SHA-256 `d7aa8e5c8ddf1215ca3be650699a6c18fe168c9eefbba86a7204718f9d39ffd2`.
  Serve the four public derivatives, not this source PNG. Preserve leaves,
  helmet, ears and chin at every rendered size; no crop or art cleanup is approved.
- Low-power and reduced-motion delivery preserves realistic material, light and
  scene composition. Reduce effects while retaining the approved master quality.

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
- For the four approved AI help derivatives only: `assetVersion`
  `2026.10.03-ai-help-face-v1`, exact `sourceMaster`, `sourceSha256` and
  `reviewScope`. Matching a filename is insufficient to inherit approval.

Run:

```text
pnpm assets:verify
```

The verifier checks reference hashes, every manifest digest, required PWA files,
all six rank families, the exact Korean wordmark and the four AI help entries'
unique paths, dimensions, source hash, MIME and narrow approval metadata.
`pnpm verify` includes this gate. Passing it establishes asset integrity, not
actual app pixels, performance, scene activation or `PRODUCT COMPLETE`.

## 8. Change procedure

1. Record the proposed visual/product reason.
2. Confirm that the change does not introduce generated copy or unapproved product claims.
3. Save a new versioned master; never mutate the canonical reference silently.
4. Run the derivative builder using its pinned workspace dependencies.
5. Review dark/light/system rendering and representative mobile/tablet/desktop crops.
6. Run asset verification, browser QA and performance budgets.
7. Update the manifest/version and release notes.
8. Retain the prior version until deployed references and caches are safely retired.

Reuse the already approved face and derivatives without regenerating the
original 84 assets or modifying their bytes. The general manifest builder
preserves face provenance only when the existing asset hash still matches.

### Semiconductor scene candidate history and follow-up

At the handoff, `semiconductor-memory-v3-clean-2026-10-03/REVIEW.md` recorded the clean master as
**PRODUCTION APPROVAL PENDING**. Its source hash is
`5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd`.
It was absent from the runtime manifest and the scene master/path/variant
allowlists remained empty at the handoff audit. Image references and approval of
the launcher do not authorize scene derivative publication or activation.
Master approval, versioned derivatives, mapping/anchors/profiles, authoritative
snapshot integration and direct responsive/theme/performance review are separate
gates before runtime use. Do not add unimplemented economic labels or motion
from placeholder mockup controls.

The later owner-delegated selection supersedes that pending state for this exact
master. Its 8 optimized derivatives are registered in manifest `2026.10.03-v3`.
The source SHA/path/variant allowlists admit only this clean pack; the prototype
reference SHA and 13 other families stay excluded. `DEFAULT_STAGE_BACKDROP` is an
explicit visual default and does not invent a product selection or activation.
The separately approved V1 economy policy does not make a source/engine/worker
connected; backend/runtime acceptance remains independent. Asset integrity and
fidelity evidence are in the master review; rendered product acceptance is pending.

## 9. Rank naming boundary

The supplied rank mockup contains more named visual examples than the requested production directory contract. V1 therefore ships exactly six neutral asset families (`rank-01`…`rank-06`). The architecture does not infer or copy generated rank names, benefits, thresholds or rewards. Product-owned rank configuration will bind real Korean names to these IDs through reviewed, versioned data.

## Phase 2 global pavilion pack

The user delegated production-quality execution of the fully inspected Drive
references. The new global pavilion preserves their city, networked Earth and
metal/semiconductor material intent in a clean native-generated decorative scene.
Its full lossless master and scope are recorded in
`generated-masters/global-pavilion-2026-10-06/REVIEW.md`. Eight AVIF/WebP derivatives
are added by `scripts/build-global-pavilion-assets.py`; all prior 96 manifest
records and runtime bytes remain unchanged. The verifier hash-locks the source,
allowed derivative paths, dimensions and scope and rejects foreign metadata.

Authentication and catalog use this decorative global scene. The approved memory
mining scene, canonical logo, mascot face and neutral ranks retain their existing
bindings. No scene selects a product or approves rewards. Every interactive
control, Korean label and financial value remains live HTML/server data.
The full source index is `mockup-source-index-2026-10-06.json`; actual browser
comparison is tracked separately and is not implied by source inspection.

## Phase 2 light semiconductor companion

Manifest `2026.10.06-v5` adds eight light-only AVIF/WebP derivatives at widths
640, 960, 1280 and 1536. Their reviewed lossless source is
`generated-masters/semiconductor-memory-light-2026-10-06/semiconductor-memory-light-master-v1.png`,
SHA-256 `113fdbc5c41772145f98f3357f27754fa1bd20602a5261c133becc0fa1126d52`.
The unchanged clean memory master and inspected `a02-m00032` light reference
guided this native companion; its review scope remains presentation only.

`scripts/build-semiconductor-light-assets.py` requires Pillow 12.3.0, validates
the complete RGB 1536×1024 source and preserves its composition without cropping,
recoloring or upscaling. WebP is lossless against the resized pixels; each AVIF
must decode at its exact dimensions with at least 40 dB PSNR. All 104 previous
manifest records and runtime files remain unchanged. Their canonical entry
digest is `bd4887df3347bc9a120d7dae412ee2a157613ec10f2d56311c7d7db3909f5262`.

The verifier admits only the eight exact versioned light paths and checks their
source, dimensions, theme and scope. Existing dark artwork remains unchanged.
Asset integrity does not approve products, rewards, or runtime scene mapping;
rendering and browser acceptance are separate evidence gates.

## Exact MOBILE HOME semiconductor tower

Manifest `2026.10.06-v6` adds eight dark AVIF/WebP derivatives at widths 640,
960, 1280 and 1536 for the delegated reconstruction of MOBILE HOME `a02-m00005`.
The reviewed RGB 1536×1024 source is
`generated-masters/semiconductor-tower-2026-10-06/semiconductor-tower-master-v1.png`,
SHA-256 `b7efda2f71a34d07460a7d50e3650bfafc9028e4b4f3e7e10a96000a9b07c9ee`.
It preserves the navy factory, left robotic arm and right six-layer HBM tower.

`scripts/build-semiconductor-tower-assets.py` uses Pillow 12.3.0, validates the
source hash and dimensions, and encodes the full composition without cropping,
recoloring or upscaling. WebP is lossless against the resized pixels; AVIF must
decode at the exact dimensions with at least 40 dB PSNR. All 112 prior records
and files remain unchanged; their canonical entry digest is
`8d52743dc225ab9b19ce812520fde3ce99d55025f618e8055e09c1010c446852`.

`SemiconductorTowerScene` selects the exact tower pack in Dark mode and the
dedicated HOME wafer pack below in Light mode. The prior memory companion
remains intact for its earlier scope. The component exposes
responsive AVIF/WebP sources and presentation only. Rendered framing uses cover
with a default 65% 45% tower position and remains subject to the Home browser
gate. This asset review authorizes HOME hero presentation only; it does not
approve another screen, the wider family, product mappings or economic rules.


## Exact Light MOBILE HOME semiconductor wafer

Manifest `2026.10.06-v7` adds eight light AVIF/WebP derivatives at widths 640,
960, 1280 and 1536 for the delegated reconstruction of Light HOME `a02-m00027`.
The reviewed RGB 1536×1024 source is
`generated-masters/semiconductor-wafer-light-2026-10-06/semiconductor-wafer-light-master-v1.png`,
SHA-256 `89651e191ac5031730531856cc3a4fe7f5b5d557e4c27bd3ec225fcde3f24848`.
It preserves the white and blue glass factory, broad low wafer at center-right,
vertical gold beam and helix, with clean space for HTML text at the left.

`scripts/build-semiconductor-wafer-light-assets.py` uses Pillow 12.3.0 and
validates the complete source, then encodes without cropping, recoloring or
upscaling. WebP is lossless against the resized pixels; AVIF must decode at the
exact dimensions with at least 40 dB PSNR. All 120 prior records and files remain
unchanged; their canonical entry digest is
`cd3bf1bea345ba0584caeaba7dc04f8a449333631037bd2b4ce25561daf644d0`.
The verifier admits only the eight exact versioned paths and their fixed source,
dimensions, Light theme and HOME-only provenance.

The HOME component uses these sources only in Light mode; its existing Dark
tower sources stay unchanged. Actual theme switching and responsive composition
remain Home browser gates. This reconstruction does not approve another screen,
the wider family, product mapping or economic rules.


## Neutral GOLD category artwork

Manifest `2026.10.06-v8` adds only eight dark AVIF/WebP derivatives at widths
320, 640, 960 and 1536 from the reviewed navy factory and gold-bar composition.
The complete RGB 1536×1024 source is
`generated-masters/gold-category-2026-10-06/gold-category-master-v1.png`,
SHA-256 `b22dced3d82446e8a946f49f29bbd5d62fc57e2b465464d7c260755d0600cf7e`.
`SOURCE.json` retains the native output identity and frozen 128-asset baseline.

`scripts/build-gold-category-assets.py` runs from the repository with a dry-run
default; `--write` adds only this exact category pack. It requires Pillow 12.3.0,
validates the source hash and RGB dimensions, and preserves the complete frame
without crop, recoloring or upscale. WebP is lossless against resized pixels;
AVIF must decode at the exact dimensions with at least 40 dB PSNR. The entire
128-entry prior set remains unchanged, with canonical entry digest
`00b8caf188b9481d87204dea866dabd41ef2b0fbf86fb71d87b679898dff6d52`.

The verifier admits only the eight exact versioned GOLD paths, fixed source,
dimensions, format, Dark theme and neutral scope. GOLD pixels are category
presentation only. They cannot stand in for SILVER or attest actual holdings,
operating catalog publication, economic values or yield. Root owns category UI
integration and actual responsive browser acceptance.


## Desktop HOME responsive artwork

Manifest `2026.10.06-v10` adds two distinct eight-file desktop families, each at
widths 960, 1280, 1536 and 1920 with full-frame AVIF and lossless WebP delivery.
Both unchanged RGB masters are exactly 1983×793. No source or derivative is
cropped, recolored, retouched or upscaled. Existing 136 records and files remain
unchanged, with canonical digest
`79f0a6cdd82e6ea098c087c5f489faf6d937f078c6fd8bcac844cc8ed461665c`.

The Dark `semiconductor-tower-desktop` master is reviewed against desktop HOME
`a02-m00017`, preserving the complete six-layer tower, robots and left greeting
space. Its SHA-256 is
`77fa85077eef2f0534d16a4900e4ada9ccc1fdcbb28c959775ca0ebcaf4b82f4`.
The Light `semiconductor-wafer-light-desktop` master extends mobile
`a02-m00027` intent responsively with the low thin wafer, white and ice-blue
factory and gold beam. Its SHA-256 is
`fb2ef6a74cba862a69229d334e84ad27e1e7dd4709702967f76d6c4242c08548`.
No Light desktop reference was supplied; this is responsive inference, not
supplied desktop reference acceptance. Each master directory retains REVIEW and
SOURCE provenance, and the frozen Dark144 pack remains unchanged.

Both repo-native generators default to dry runs; `--write` adds only their
exact eight reviewed files and manifest entries. Pillow 12.3.0, exact source
hash/dimensions, lossless resized WebP pixels and minimum 40 dB AVIF fidelity are
required. The Light addition preserves all 144 preceding records and bytes,
with digest `276dd5899d05f9cbb8dedb50edabbe9b600d214eaa18bec3ab1a6082c11da7fb`.
The verifier checks only exact approved paths and fixed source, aspect ratio,
format, theme and scope. Root owns media selection, DOM, responsive positioning
and real browser acceptance. These assets add no product or economic approval.
