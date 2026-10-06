"""Encode the delegated complete global pavilion scene as responsive runtime assets.

The hash-locked RGB master remains untouched. Width variants use the full image,
Lanczos downsampling and its original aspect ratio; there is no crop, recoloring,
upscale, generated content or network access. WebP preserves the resized pixels
losslessly. AVIF uses reviewed high-quality 4:4:4 encoding. The default is a dry
run. --write adds only this scene pack, retaining all 96 existing entries/bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
MANIFEST = PUBLIC / "brand" / "assets.manifest.json"
MASTER_PATH = "docs/design/generated-masters/global-pavilion-2026-10-06/global-pavilion-master-v1.png"
MASTER_HASH = "82c8d567d0da86ce72052d6415e198793198f9886e65a21d0eadd859b66e1a32"
LEGACY_HASH = "71a28aa4af200d846603803b12d01b476e5028497b8a2f28c0a4a795d363893f"
SNAPSHOT_VERSION = "2026.10.06-v5"
ASSET_VERSION = "2026.10.06-global-pavilion-v1"
PATH_PREFIX = "/brand/scenes/global-pavilion/global-pavilion-"
REVIEW_SCOPE = (
    "User-delegated Phase 2 production-quality artwork from fully inspected "
    "Drive reference families: coherent city, networked Earth and material pavilion; "
    "complete 1536x1024 composition, no production copy, responsive encoding only; "
    "no economic approval or product-specific runtime mapping."
)
ALT = "금빛 도시와 푸른 지구, 금속과 반도체가 놓인 원형 전시 공간"
WIDTHS = (640, 960, 1280, 1536)

LIGHT_PATHS = {
    f"/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-{width}-v1.{extension}"
    for width in (640, 960, 1280, 1536) for extension in ("avif", "webp")
}


def sha256(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def assert_existing_assets(manifest: dict[str, object]) -> None:
    seen: set[str] = set()
    for asset in manifest["assets"]:
        relative = asset["path"]
        if not relative.startswith(("/brand/", "/ranks/")) or ".." in relative:
            raise SystemExit(f"Unsafe existing asset path: {relative}")
        if relative in seen:
            raise SystemExit(f"Duplicate existing asset path: {relative}")
        seen.add(relative)
        contents = (PUBLIC / relative.lstrip("/")).read_bytes()
        if sha256(contents) != asset["sha256"] or len(contents) != asset["bytes"]:
            raise SystemExit(f"Existing asset integrity failed: {relative}")
    legacy = [
        asset for asset in manifest["assets"]
        if not asset["path"].startswith(PATH_PREFIX) and asset["path"] not in LIGHT_PATHS
    ]
    digest = sha256(json.dumps(legacy, ensure_ascii=False, separators=(",", ":")).encode())
    if len(legacy) != 96 or digest != LEGACY_HASH:
        raise SystemExit("The preserved 96-entry asset baseline changed.")


def generate_derivatives() -> list[tuple[dict[str, object], bytes]]:
    import PIL
    from PIL import Image, ImageChops, ImageStat, features

    if PIL.__version__ != "12.3.0":
        raise SystemExit("Use scripts/brand-assets.requirements.txt (Pillow 12.3.0).")
    if not features.check("avif") or not features.check("webp"):
        raise SystemExit("The pinned Pillow runtime must support AVIF and WebP.")
    master = ROOT / MASTER_PATH
    if sha256(master.read_bytes()) != MASTER_HASH:
        raise SystemExit("Delegated global pavilion master hash changed.")
    with Image.open(master) as image:
        if image.mode != "RGB" or image.size != (1536, 1024):
            raise SystemExit("Approved master must remain the complete 1536x1024 RGB PNG.")
        source = image.copy()

    derivatives = []
    for width in WIDTHS:
        height = round(source.height * width / source.width)
        resized = source if width == source.width else source.resize(
            (width, height), Image.Resampling.LANCZOS
        )
        for extension, format_name, options in (
            (
                "avif", "AVIF",
                {"quality": 94, "speed": 6, "subsampling": "4:4:4", "max_threads": 1},
            ),
            ("webp", "WEBP", {"lossless": True, "method": 6, "exact": True}),
        ):
            buffer = io.BytesIO()
            resized.save(buffer, format_name, **options)
            contents = buffer.getvalue()
            relative = f"{PATH_PREFIX}{width}-v1.{extension}"
            record = {
                "path": relative,
                "bytes": len(contents),
                "sha256": sha256(contents),
                "mimeType": f"image/{extension}",
                "alt": ALT,
                "width": width,
                "height": height,
                "theme": "system",
                "assetVersion": ASSET_VERSION,
                "sourceMaster": MASTER_PATH,
                "sourceSha256": MASTER_HASH,
                "reviewScope": REVIEW_SCOPE,
            }
            with Image.open(io.BytesIO(contents)) as decoded:
                if decoded.size != resized.size or decoded.mode != "RGB":
                    raise SystemExit(f"Derivative changed dimensions/mode: {relative}")
                difference = ImageChops.difference(resized, decoded)
                if extension == "webp" and difference.getbbox() is not None:
                    raise SystemExit(f"Lossless fallback altered resized pixels: {relative}")
                if extension == "avif":
                    rms = ImageStat.Stat(difference).rms
                    mse = sum(value * value for value in rms) / len(rms)
                    psnr = math.inf if mse == 0 else 10 * math.log10(255 * 255 / mse)
                    if psnr < 40:
                        raise SystemExit(f"AVIF fidelity below 40dB: {relative} ({psnr:.2f})")
            target = PUBLIC / relative.lstrip("/")
            if target.exists() and sha256(target.read_bytes()) != record["sha256"]:
                raise SystemExit(f"Refusing to overwrite a different versioned derivative: {relative}")
            derivatives.append((record, contents))
    return derivatives


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Write the approved additive pack.")
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1:
        raise SystemExit("Unsupported brand manifest schema.")
    assert_existing_assets(manifest)
    derivatives = generate_derivatives()
    replacements = {record["path"]: record for record, _ in derivatives}
    legacy = [asset for asset in manifest["assets"] if asset["path"] not in replacements]
    updated = {
        **manifest,
        "assetVersion": SNAPSHOT_VERSION,
        "generatedAt": "2026-10-06T00:00:00Z",
        "assets": sorted([*legacy, *replacements.values()], key=lambda asset: asset["path"]),
    }
    if args.write:
        for record, contents in derivatives:
            target = PUBLIC / str(record["path"]).lstrip("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
        MANIFEST.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        assert_existing_assets(updated)
    print(json.dumps({
        "mode": "write" if args.write else "dry-run",
        "assetVersion": SNAPSHOT_VERSION,
        "preservedLegacyEntries": len(legacy),
        "assets": [record for record, _ in derivatives],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
