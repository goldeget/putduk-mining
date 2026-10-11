"""Encode only the delegated reviewed Signup scene as full-frame responsive assets.

The hash-locked native RGB PNG remains untouched. No crop, recoloring, upscale,
raster UI, network access or financial meaning is introduced. Default dry-run;
--write is confined to exact versioned Signup paths and preserves all232 earlier
records and bytes. Existing mismatched metadata/files fail before writes.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import math
import re
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
MANIFEST = PUBLIC / "brand" / "assets.manifest.json"
MASTER_PATH = 'docs/design/generated-masters/signup-semiconductor-mobile-dark-2026-10-06/signup-semiconductor-mobile-dark-master-v1.png'
MASTER_HASH = '15a778ee8ee97a3a3a3199d97ed7c9de0394fc8874a1540cd934fc1138505ffe'
LEGACY_HASH = '67dec18880a031d75b085f26a095b27ed5efb1e72ccfb7b0cacf30432b3ddbbe'
SNAPSHOT_VERSION = '2026.10.06-v17'
ASSET_VERSION = '2026.10.06-signup-semiconductor-mobile-dark-v1'
PATH_PREFIX = '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-'
REVIEW_SCOPE = 'User-delegated 2026-10-06 Signup a02-m00002 (duplicate a02-m00009) scene reconstruction: portrait navy semiconductor factory, six-layer gold memory tower above a circular wafer and two robot arms, dark lower negative space; complete 941x1672 composition, responsive encoding only, no crop, recoloring or upscale; Signup decoration only, no raster UI or copy, financial values, holdings, mining yield, catalog publication, economic approval or whole-screen acceptance. No supplied Signup Light reference acceptance.'
ALT = '짙은 푸른 반도체 공장에서 금빛 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 가입 장면'
WIDTHS = (480, 640, 941)
APPROVED_PATHS = {f"{PATH_PREFIX}{width}-v1.{extension}" for width in WIDTHS for extension in ("avif", "webp")}


SIGNUP_PROFILES = [{'family': 'signup-semiconductor-mobile-dark', 'widths': [480, 640, 941], 'nativeWidth': 941, 'nativeHeight': 1672, 'sourceMaster': 'docs/design/generated-masters/signup-semiconductor-mobile-dark-2026-10-06/signup-semiconductor-mobile-dark-master-v1.png', 'sourceSha256': '15a778ee8ee97a3a3a3199d97ed7c9de0394fc8874a1540cd934fc1138505ffe', 'assetVersion': '2026.10.06-signup-semiconductor-mobile-dark-v1', 'reviewScope': 'User-delegated 2026-10-06 Signup a02-m00002 (duplicate a02-m00009) scene reconstruction: portrait navy semiconductor factory, six-layer gold memory tower above a circular wafer and two robot arms, dark lower negative space; complete 941x1672 composition, responsive encoding only, no crop, recoloring or upscale; Signup decoration only, no raster UI or copy, financial values, holdings, mining yield, catalog publication, economic approval or whole-screen acceptance. No supplied Signup Light reference acceptance.', 'theme': 'dark', 'alt': '짙은 푸른 반도체 공장에서 금빛 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 가입 장면'}]
ALL_SIGNUP_PATHS = {
    f"/brand/scenes/{profile['family']}/{profile['family']}-{width}-v1.{extension}": {
        key: value for key, value in {
            **{key: profile[key] for key in ("sourceMaster", "sourceSha256", "assetVersion", "reviewScope", "theme", "alt")},
            "width": width,
            "height": round(profile["nativeHeight"] * width / profile["nativeWidth"]),
            "mimeType": "image/" + extension,
        }.items()
    }
    for profile in SIGNUP_PROFILES for width in profile["widths"] for extension in ("avif", "webp")
}


PRODUCTS_PATHS = {'/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-960-v1.webp', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-640-v1.webp', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-960-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1536-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1280-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1280-v1.webp', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-640-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1536-v1.webp', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-480-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-480-v1.webp', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1920-v1.avif', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1920-v1.webp'}


AI_PATHS = {'/brand/scenes/ai-partner-hero/ai-partner-hero-1920-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-1280-v1.avif', '/brand/scenes/ai-partner-hero/ai-partner-hero-1536-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-1536-v1.avif', '/brand/scenes/ai-partner-hero/ai-partner-hero-960-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-1280-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-960-v1.avif', '/brand/scenes/ai-partner-hero/ai-partner-hero-640-v1.avif', '/brand/scenes/ai-partner-hero/ai-partner-hero-1920-v1.avif', '/brand/scenes/ai-partner-hero/ai-partner-hero-640-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-480-v1.webp', '/brand/scenes/ai-partner-hero/ai-partner-hero-480-v1.avif'}


def sha256(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def signup_metadata_failures(asset: dict[str, object]) -> list[str]:
    expected = ALL_SIGNUP_PATHS.get(asset.get("path"))
    if expected is None:
        return ["UNREVIEWED_SIGNUP_PATH"]
    errors = [f"SIGNUP_{key.upper()}_MISMATCH" for key, value in expected.items()
              if type(asset.get(key)) is not type(value) or asset.get(key) != value]
    if set(asset) != {"path", "bytes", "sha256", *expected}:
        errors.append("UNREVIEWED_SIGNUP_METADATA")
    if type(asset.get("bytes")) is not int or asset["bytes"] <= 0:
        errors.append("SIGNUP_INVALID_BYTES_TYPE")
    if not isinstance(asset.get("sha256"), str) or re.fullmatch(r"[0-9a-f]{64}", asset["sha256"]) is None:
        errors.append("SIGNUP_INVALID_SHA256")
    return errors


def asset_metadata_failures(asset: dict[str, object]) -> list[str]:
    if asset.get("path") not in APPROVED_PATHS:
        return ["UNREVIEWED_SIGNUP_FAMILY_PATH"]
    return signup_metadata_failures(asset)


def runtime_asset_integrity_failures(asset: dict[str, object], contents: bytes) -> list[str]:
    errors = []
    if sha256(contents) != asset.get("sha256"):
        errors.append("SIGNUP_RUNTIME_HASH_MISMATCH")
    if len(contents) != asset.get("bytes"):
        errors.append("SIGNUP_RUNTIME_BYTES_MISMATCH")
    return errors


def assert_existing_assets(manifest: dict[str, object]) -> None:
    from PIL import Image
    seen: set[str] = set()
    for asset in manifest["assets"]:
        relative = asset["path"]
        if not isinstance(relative, str) or not relative.startswith(("/brand/", "/ranks/")) or ".." in relative or "\\" in relative:
            raise SystemExit("Unsafe existing asset path.")
        if relative in seen:
            raise SystemExit("Duplicate existing asset path.")
        seen.add(relative)
        contents = (PUBLIC / relative.lstrip("/")).read_bytes()
        if sha256(contents) != asset["sha256"] or len(contents) != asset["bytes"]:
            raise SystemExit("Existing asset integrity failed.")
        is_signup = any(relative.startswith(f"/brand/scenes/{profile['family']}/") for profile in SIGNUP_PROFILES)
        if is_signup:
            if signup_metadata_failures(asset):
                raise SystemExit("Existing Signup metadata failed exact ownership/provenance validation.")
            with Image.open(io.BytesIO(contents)) as decoded:
                expected_format = "AVIF" if asset["mimeType"] == "image/avif" else "WEBP"
                if decoded.format != expected_format or decoded.mode != "RGB" or decoded.size != (asset["width"], asset["height"]):
                    raise SystemExit("Existing Signup decoded format/dimensions failed.")
    legacy = [asset for asset in manifest["assets"] if ((asset["path"] not in ALL_SIGNUP_PATHS) and asset["path"] not in PRODUCTS_PATHS) and asset["path"] not in AI_PATHS]
    digest = sha256(json.dumps(legacy, ensure_ascii=False, separators=(",", ":")).encode())
    if len(legacy) != 232 or digest != LEGACY_HASH:
        raise SystemExit("The preserved 232-entry asset baseline changed.")


def generate_derivatives() -> list[tuple[dict[str, object], bytes]]:
    import PIL
    from PIL import Image, ImageChops, ImageStat, features

    if PIL.__version__ != "12.3.0":
        raise SystemExit("Use scripts/brand-assets.requirements.txt (Pillow 12.3.0).")
    if not features.check("avif") or not features.check("webp"):
        raise SystemExit("The pinned Pillow runtime must support AVIF and WebP.")
    master = ROOT / MASTER_PATH
    if sha256(master.read_bytes()) != MASTER_HASH:
        raise SystemExit("Reviewed Signup master hash changed.")
    with Image.open(master) as image:
        if image.format != "PNG" or image.mode != "RGB" or image.size != (941, 1672):
            raise SystemExit("Approved master must remain the complete 941x1672 RGB PNG.")
        source = image.copy()

    derivatives = []
    for width in WIDTHS:
        if width > source.width:
            raise SystemExit("Upscaling the reviewed Signup master is forbidden.")
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
                "theme": 'dark',
                "assetVersion": ASSET_VERSION,
                "sourceMaster": MASTER_PATH,
                "sourceSha256": MASTER_HASH,
                "reviewScope": REVIEW_SCOPE,
            }
            if asset_metadata_failures(record) or runtime_asset_integrity_failures(record, contents):
                raise SystemExit("Encoded SIGNUP derivative violated its exact metadata/integrity contract.")
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
