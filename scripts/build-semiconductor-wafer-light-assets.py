"""Encode the delegated exact Light HOME semiconductor wafer scene as responsive runtime assets.

The hash-locked RGB master remains untouched. Width variants use the full image,
Lanczos downsampling and its original aspect ratio; there is no crop, recoloring,
upscale, generated content or network access. WebP preserves the resized pixels
losslessly. AVIF uses reviewed high-quality 4:4:4 encoding. The default is a dry
run. --write adds only this scene pack, retaining all 120 existing entries/bytes.
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
MASTER_PATH = (
    "docs/design/generated-masters/semiconductor-wafer-light-2026-10-06/"
    "semiconductor-wafer-light-master-v1.png"
)
MASTER_HASH = "89651e191ac5031730531856cc3a4fe7f5b5d557e4c27bd3ec225fcde3f24848"
LEGACY_HASH = "cd3bf1bea345ba0584caeaba7dc04f8a449333631037bd2b4ce25561daf644d0"
SNAPSHOT_VERSION = "2026.10.06-v17"
ASSET_VERSION = "2026.10.06-semiconductor-wafer-light-v1"
PATH_PREFIX = "/brand/scenes/semiconductor-wafer-light/semiconductor-wafer-light-"
REVIEW_SCOPE = (
    "User-delegated 2026-10-06 exact Light MOBILE HOME a02-m00027 reconstruction: "
    "white and blue glass semiconductor factory, broad low circular wafer and vertical "
    "gold beam with helix; complete 1536x1024 composition, responsive encoding only, "
    "no crop, recoloring or upscale; HOME hero presentation only, no broad screen "
    "acceptance, economic or product mapping approval."
)
ALT = "밝은 유리 반도체 공장 안에서 넓고 낮은 원형 웨이퍼와 금빛 수직 광선이 빛나는 장면"
WIDTHS = (640, 960, 1280, 1536)
APPROVED_PATHS = {
    f"{PATH_PREFIX}{width}-v1.{extension}"
    for width in WIDTHS for extension in ("avif", "webp")
}


GOLD_PATHS = {
    f"/brand/scenes/gold-category/gold-category-{width}-v1.{extension}"
    for width in (320, 640, 960, 1536) for extension in ("avif", "webp")
}


DESKTOP_TOWER_PATHS = {
    f"/brand/scenes/semiconductor-tower-desktop/semiconductor-tower-desktop-{width}-v1.{extension}"
    for width in (960, 1280, 1536, 1920) for extension in ("avif", "webp")
}

DESKTOP_WAFER_LIGHT_PATHS = {
    f"/brand/scenes/semiconductor-wafer-light-desktop/semiconductor-wafer-light-desktop-{width}-v1.{extension}"
    for width in (960, 1280, 1536, 1920) for extension in ("avif", "webp")
}


LOGIN_PATHS = {
    f"/brand/scenes/{family}/{family}-{width}-v1.{extension}"
    for family, widths in (
        ("login-wafer-dark", (480, 640, 941)),
        ("login-semiconductor-dark", (960, 1280, 1536, 1920)),
        ("login-semiconductor-light", (960, 1280, 1536, 1920)),
    ) for width in widths for extension in ("avif", "webp")
}


GIFT_PATHS = {
    f"/brand/scenes/home-event-gift/home-event-gift-{width}-v1.{extension}"
    for width in (480, 960, 1280, 1920) for extension in ("avif", "webp")
}


MINING_PATHS = {
    f"/brand/scenes/{family}/{family}-{width}-v1.{extension}"
    for family, widths in (
        ("mining-semiconductor-mobile-dark", (480, 640, 941)),
        ("mining-semiconductor-desktop-dark", (960, 1280, 1536, 1920)),
        ("mining-semiconductor-desktop-light", (960, 1280, 1536, 1920)),
    ) for width in widths for extension in ("avif", "webp")
}


WALLET_PATHS = {'/brand/scenes/wallet-chip-mobile-light/wallet-chip-mobile-light-480-v1.webp', '/brand/scenes/wallet-chip-desktop-light/wallet-chip-desktop-light-1280-v1.webp', '/brand/scenes/wallet-vault-mobile-dark/wallet-vault-mobile-dark-941-v1.avif', '/brand/scenes/wallet-chip-mobile-light/wallet-chip-mobile-light-640-v1.webp', '/brand/scenes/wallet-vault-desktop-dark/wallet-vault-desktop-dark-1920-v1.avif', '/brand/scenes/wallet-chip-mobile-light/wallet-chip-mobile-light-640-v1.avif', '/brand/scenes/wallet-chip-mobile-light/wallet-chip-mobile-light-940-v1.webp', '/brand/scenes/wallet-chip-desktop-light/wallet-chip-desktop-light-1920-v1.webp', '/brand/scenes/wallet-vault-desktop-dark/wallet-vault-desktop-dark-1920-v1.webp', '/brand/scenes/wallet-vault-mobile-dark/wallet-vault-mobile-dark-941-v1.webp', '/brand/scenes/wallet-chip-desktop-light/wallet-chip-desktop-light-1536-v1.avif', '/brand/scenes/wallet-chip-desktop-light/wallet-chip-desktop-light-960-v1.webp', '/brand/scenes/wallet-vault-desktop-dark/wallet-vault-desktop-dark-1280-v1.webp', '/brand/scenes/wallet-chip-desktop-light/wallet-chip-desktop-light-960-v1.avif', '/brand/scenes/wallet-vault-mobile-dark/wallet-vault-mobile-dark-480-v1.avif', '/brand/scenes/wallet-vault-mobile-dark/wallet-vault-mobile-dark-480-v1.webp', '/brand/scenes/wallet-vault-mobile-dark/wallet-vault-mobile-dark-640-v1.webp', '/brand/scenes/wallet-vault-desktop-dark/wallet-vault-desktop-dark-1536-v1.webp', '/brand/scenes/wallet-vault-mobile-dark/wallet-vault-mobile-dark-640-v1.avif', '/brand/scenes/wallet-vault-desktop-dark/wallet-vault-desktop-dark-1536-v1.avif', '/brand/scenes/wallet-chip-desktop-light/wallet-chip-desktop-light-1280-v1.avif', '/brand/scenes/wallet-chip-desktop-light/wallet-chip-desktop-light-1536-v1.webp', '/brand/scenes/wallet-chip-desktop-light/wallet-chip-desktop-light-1920-v1.avif', '/brand/scenes/wallet-vault-desktop-dark/wallet-vault-desktop-dark-960-v1.webp', '/brand/scenes/wallet-chip-mobile-light/wallet-chip-mobile-light-480-v1.avif', '/brand/scenes/wallet-vault-desktop-dark/wallet-vault-desktop-dark-960-v1.avif', '/brand/scenes/wallet-vault-desktop-dark/wallet-vault-desktop-dark-1280-v1.avif', '/brand/scenes/wallet-chip-mobile-light/wallet-chip-mobile-light-940-v1.avif'}


SIGNUP_PATHS = {'/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-640-v1.webp', '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-640-v1.avif', '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-941-v1.webp', '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-480-v1.avif', '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-480-v1.webp', '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-941-v1.avif'}


PRODUCTS_PATHS = {'/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-960-v1.webp', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-640-v1.webp', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-960-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1536-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1280-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1280-v1.webp', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-640-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1536-v1.webp', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-480-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-480-v1.webp', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1920-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1920-v1.webp'}


AI_PATHS = {'/brand/scenes/ai-partner-hero/ai-partner-hero-1920-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-1280-v1.avif', '/brand/scenes/ai-partner-hero/ai-partner-hero-1536-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-1536-v1.avif', '/brand/scenes/ai-partner-hero/ai-partner-hero-960-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-1280-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-960-v1.avif', '/brand/scenes/ai-partner-hero/ai-partner-hero-640-v1.avif', '/brand/scenes/ai-partner-hero/ai-partner-hero-1920-v1.avif', '/brand/scenes/ai-partner-hero/ai-partner-hero-640-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-480-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-480-v1.avif'}


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
        if ((((asset["path"] not in APPROVED_PATHS and asset["path"] not in GOLD_PATHS and asset["path"] not in DESKTOP_TOWER_PATHS and asset["path"] not in DESKTOP_WAFER_LIGHT_PATHS and asset["path"] not in LOGIN_PATHS and asset["path"] not in GIFT_PATHS and asset["path"] not in MINING_PATHS) and asset["path"] not in WALLET_PATHS) and asset["path"] not in SIGNUP_PATHS) and asset["path"] not in PRODUCTS_PATHS) and asset["path"] not in AI_PATHS
    ]
    digest = sha256(json.dumps(legacy, ensure_ascii=False, separators=(",", ":")).encode())
    if len(legacy) != 120 or digest != LEGACY_HASH:
        raise SystemExit("The preserved 120-entry asset baseline changed.")


def generate_derivatives() -> list[tuple[dict[str, object], bytes]]:
    import PIL
    from PIL import Image, ImageChops, ImageStat, features

    if PIL.__version__ != "12.3.0":
        raise SystemExit("Use scripts/brand-assets.requirements.txt (Pillow 12.3.0).")
    if not features.check("avif") or not features.check("webp"):
        raise SystemExit("The pinned Pillow runtime must support AVIF and WebP.")
    master = ROOT / MASTER_PATH
    if sha256(master.read_bytes()) != MASTER_HASH:
        raise SystemExit("Delegated HOME semiconductor tower master hash changed.")
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
                "theme": "light",
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
