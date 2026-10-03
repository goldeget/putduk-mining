# PUTDUK Generated Source Masters

Status: **VERSIONED BUILD INPUTS / NOT RUNTIME ASSETS**

These lossless PNG files were generated specifically for PUTDUK MINING from the canonical art-direction references. They contain no production typography, labels, logos, numbers or watermarks. Application routes must use optimized derivatives from `public/brand/` and `public/ranks/`; source masters must not be served directly.

| Source master | Role | SHA-256 |
| --- | --- | --- |
| `putduk-miner-master-v1.png` | Transparent full-body sprout-miner mascot | `5efb45738d0cdd72bfb2cc3a24a31d6034eeb33277daa375bf05ab51b8eb1fea` |
| `ai-help-face-2026-10-03/putduk-ai-help-face-master-v1.png` | Approved transparent AI help launcher face; original complete square composition | `d7aa8e5c8ddf1215ca3be650699a6c18fe168c9eefbba86a7204718f9d39ffd2` |
| `putduk-orbital-earth-master-v1.png` | Text-free orbital Earth/space world | `97258f8bbcaab9ba88c16d832c37c336e464afd9d09b7a42e6da4103da093d1b` |
| `ranks/rank-01/planet-master-v1.png` | Bronze/mineral neutral rank planet | `bec995da794ab7fd9c9c9336e363f25afda9423f80a86d5b77ddb835763785b4` |
| `ranks/rank-02/planet-master-v1.png` | Silver/graphite neutral rank planet | `bf49055c7dcccabb7f6f0e38db0d20302ed22cdca0c82ea25b3a6b35e192e6be` |
| `ranks/rank-03/planet-master-v1.png` | Gold/obsidian neutral rank planet | `7850fef221106b88653e6c616e0cd9b7de5751606071fe78d65379b362b1ec95` |
| `ranks/rank-04/planet-master-v1.png` | Platinum/crystal neutral rank planet | `44223317d5652f0f8a3af58b871e5b9a376d01246e79199a73149077c2ad74e7` |
| `ranks/rank-05/planet-master-v1.png` | Sapphire/diamond neutral rank planet | `75a976baaf4f7edaac4e6fd0e4af64a3e15e21cd46585aa723ec69413b50a026` |
| `ranks/rank-06/planet-master-v1.png` | Obsidian/gold apex planet with crown-like halo | `73cb455e6415283bb50604897ab7af8a234031c737e707d220db1b9d4f0ecc08` |

Replacing a master requires a new asset version, visual review, hash update, derivative rebuild and `pnpm assets:verify`.

## Approved AI help face — 2026-10-03

The owner adopted batch 7 and the `AI 도움` robot launcher on 2026-10-03.
This 1254×1254 RGBA PNG preserves the exact approved generation bytes. Approval
covers this face and launcher only. The scene master and economic approvals
remain pending; this approval does not replace the existing full-body master
or approve other assets or product flows.

The approved placement is the normal-flow help row below the dominant mining
scene and above the five tabs, with `상세 보기` and `AI 도움`. The mining view
provides the detail anchor. `퍼뜩 AI` names the helper; mobile opens a full
conversation and desktop opens a right panel with a wide-view option. Preserve
the complete leaves, helmet, ears and chin rather than a cropped upper body.
This placement approval is not actual app acceptance of focus, auth, keyboard,
modal collisions, scrolling, responsive rendering or performance.

`scripts/build-ai-help-assets.py` resizes the complete square to 128 and 256
pixels, with premultiplied-alpha Lanczos resampling and deterministic AVIF/WebP
encoding using the pinned Pillow 12.3.0 runtime. It never crops, regenerates,
repaints or adds typography. Runtime delivery must use the whole face with
`object-fit: contain`. Run its default dry run, then `--write` only for approved
asset generation; existing versioned bytes must match before any overwrite.

The four `/brand/mascot/putduk-ai-help-face-{128,256}-v1.{avif,webp}` derivatives
carry asset version `2026.10.03-ai-help-face-v1`, the exact source path and hash,
and this narrow review scope in manifest snapshot `2026.10.03-v2`. All existing
manifest entries and asset bytes remain unchanged. Source masters are build
inputs and must not be served by the launcher.

The runtime manifest version and the `visual-lab-2026.09.27-v1` benchmark
identifier are separate. Reuse the already approved face without generating or
cleaning it again. Existing full-body, Earth and neutral rank assets remain.

## Pending semiconductor scene — 2026-10-03

Historical state at initial review. The follow-up owner-delegated selection below
supersedes pending approval only for this exact master; preserve the initial record.

`semiconductor-memory-v3-clean-2026-10-03/REVIEW.md` records the source candidate
`semiconductor-memory-v3-clean-master-v1.png`, SHA-256
`5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd`, as
**PRODUCTION APPROVAL PENDING**. Its realistic metal, gold/blue reflected light,
HBM/wafer/fab composition and spatial depth are a quality reference. New reference
photos and the face/layout approval do not approve this scene or economic values.

Do not publish its master PNG, activate an allowlist entry or generate production
derivatives/mapping on that basis. Master approval precedes immutable version and
hash, responsive derivatives, reviewed anchors/profiles, authoritative snapshot
integration and direct pixels/performance review. Low-power and reduced-motion
modes preserve approved image quality while limiting effects; they do not replace
the scene with a flat illustration. Text, financial values and controls remain
HTML/CSS or reviewed SVG outside generated pixels.

## Approved semiconductor scene pack — follow-up 2026-10-03

The owner delegated visual selection and the unchanged clean master above was
selected for app use. `scripts/build-semiconductor-scene-assets.py` emits full
composition widths640/960/1280/1539 in AVIF and lossless WebP. Runtime version is
`2026.10.03-semiconductor-memory-v1`; manifest is `2026.10.03-v3` with96 assets,
retaining every prior88 entry and byte. The lossless master PNG stays here.

Only the memory family is approved. The explicit default backdrop uses this
registered visual without guessing product/category/engine state. Other13
families and the SK Hynix reference SHA remain unapproved. Anchors, decode
fidelity, exact hashes and remaining product gates are in the
[review](semiconductor-memory-v3-clean-2026-10-03/REVIEW.md).

The separate [V1 economic approval](../../product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md)
supersedes earlier pending values within its own scope. Asset approval does not
implement or publish the engine, money commands, server snapshot or settlement.
