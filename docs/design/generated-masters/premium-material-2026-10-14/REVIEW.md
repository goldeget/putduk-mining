# Shared premium material pair — 2026-10-14

Status: **OWNER-DELEGATED PRESENTATION CANDIDATE / PRODUCT REVIEW PENDING**

The owner identified inconsistent quality between landing/login/mining and the
rest of the platform and reiterated premium UI/UX and GPT image generation when
needed. These two built-in generated masters provide a shared physical material
family for page headings and the empty AI welcome area. They do not replace the
current sprout-P identity, launcher face or approved industrial scene packs.

Dark uses carbon glass, titanium and a restrained gold seam. The Light companion
preserves the composition with ivory ceramic glass and champagne metal. Both
were visually inspected: no raster text, logo, financial values, UI controls or
grid. The actual output is RGB2164×727; it is not a4K master. SOURCE.json and
PROMPTS.md retain generation identity, hashes and complete prompts.

`scripts/build-premium-material-assets.py` uses pinned Pillow12.3.0, preserves
the complete source, and downsamples without crop/recolor/upscale. Two widths per
theme produce8 AVIF/lossless WebP derivatives. AVIF decoded fidelity is at least
40dB PSNR; WebP decoded pixels exactly match the resize. Existing versioned
images are never overwritten. An existing manifest may differ in JSON formatting
only; its bytes are retained when metadata is identical.

`public/brand/premium.manifest.json` registers this current additive family and
eight byte-identical admin public copies. Historic v18 assets and the separate
current identity manifest remain byte-identical. The main asset verifier invokes
the new exact-path/hash/metadata/master/copy verifier.

Runtime uses a semantic theme image-set and responsive widths. Heading art stays
behind a bounded decorative region, has no pointer events, and is hidden in
forced-colors mode. AI uses an in-flow welcome strip, never a layer behind an
answer or the composer. Light/Dark/System geometry and actual asset decode must
be checked after the final CSS freeze. This review is not authenticated product,
contrast, performance, browser-regression or release acceptance.
