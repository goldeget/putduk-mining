"""Optimize the approved AI help face without cropping or altering its artwork.

The lossless master is an immutable, hash-checked build input. Only its complete
square composition is resized, with premultiplied-alpha Lanczos resampling.
The default is a dry run; --write creates four versioned runtime derivatives
and adds their reviewed provenance to the manifest without rebuilding legacy
assets. No provider, database or network is used.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
MANIFEST = PUBLIC / "brand" / "assets.manifest.json"
MASTER_PATH = (
    "docs/design/generated-masters/ai-help-face-2026-10-03/"
    "putduk-ai-help-face-master-v1.png"
)
MASTER_HASH = "d7aa8e5c8ddf1215ca3be650699a6c18fe168c9eefbba86a7204718f9d39ffd2"
SNAPSHOT_VERSION = "2026.10.06-v17"
ASSET_VERSION = "2026.10.03-ai-help-face-v1"
REVIEW_SCOPE = (
    "Owner-approved batch 7 AI help launcher face; preserve the complete "
    "1254x1254 composition with object-fit: contain; no scene, economic "
    "or other asset approval."
)
ALT = "금빛 헬멧과 새싹을 쓴 퍼뜩 AI 도움 얼굴"


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


def generate_derivatives() -> list[tuple[dict[str, object], bytes]]:
    import PIL
    from PIL import Image, features

    if PIL.__version__ != "12.3.0":
        raise SystemExit("Use scripts/brand-assets.requirements.txt (Pillow 12.3.0).")
    if not features.check("avif") or not features.check("webp"):
        raise SystemExit("The pinned Pillow runtime must support AVIF and WebP.")
    master = ROOT / MASTER_PATH
    if sha256(master.read_bytes()) != MASTER_HASH:
        raise SystemExit("Approved AI help face master hash changed.")
    with Image.open(master) as image:
        if image.mode != "RGBA" or image.size != (1254, 1254):
            raise SystemExit(
                "Approved master must remain the complete 1254x1254 RGBA PNG."
            )
        source = image.convert("RGBa")

    derivatives = []
    for size in (128, 256):
        resized = source.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
        for extension, format_name, options in (
            (
                "avif",
                "AVIF",
                {"quality": 85, "speed": 6, "subsampling": "4:4:4", "max_threads": 1},
            ),
            (
                "webp",
                "WEBP",
                {
                    "quality": 92,
                    "method": 6,
                    "lossless": False,
                    "exact": True,
                    "alpha_quality": 100,
                },
            ),
        ):
            buffer = io.BytesIO()
            resized.save(buffer, format_name, **options)
            contents = buffer.getvalue()
            relative = f"/brand/mascot/putduk-ai-help-face-{size}-v1.{extension}"
            record = {
                "path": relative,
                "bytes": len(contents),
                "sha256": sha256(contents),
                "mimeType": f"image/{extension}",
                "alt": ALT,
                "width": size,
                "height": size,
                "theme": "system",
                "assetVersion": ASSET_VERSION,
                "sourceMaster": MASTER_PATH,
                "sourceSha256": MASTER_HASH,
                "reviewScope": REVIEW_SCOPE,
            }
            with Image.open(io.BytesIO(contents)) as decoded:
                if (
                    decoded.size != (size, size)
                    or "A" not in decoded.getbands()
                    or decoded.getchannel("A").getextrema() != (0, 255)
                ):
                    raise SystemExit(f"Derivative lost dimensions or alpha: {relative}")
            target = PUBLIC / relative.lstrip("/")
            if target.exists() and sha256(target.read_bytes()) != record["sha256"]:
                raise SystemExit(
                    f"Refusing to overwrite a different versioned derivative: {relative}"
                )
            derivatives.append((record, contents))
    return derivatives


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write approved derivatives and additive manifest.",
    )
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
        "assets": sorted(
            [*legacy, *replacements.values()], key=lambda asset: asset["path"]
        ),
    }
    if args.write:
        for record, contents in derivatives:
            target = PUBLIC / str(record["path"]).lstrip("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
        MANIFEST.write_text(
            json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        assert_existing_assets(updated)
    print(
        json.dumps(
            {
                "mode": "write" if args.write else "dry-run",
                "assetVersion": SNAPSHOT_VERSION,
                "preservedLegacyEntries": len(legacy),
                "assets": [record for record, _ in derivatives],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
