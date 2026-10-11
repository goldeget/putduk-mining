"""Encode complete, source-locked native material artwork without editing it.

Default: dry run. --write creates only the new category pack; the existing 262
brand assets and metadata remain unchanged. No cropping/recoloring/upscaling.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path

import PIL
from PIL import Image, ImageChops, ImageStat, features

ROOT = Path(__file__).resolve().parents[1]
PROFILE_PATH = ROOT / "scripts/catalog-material-profiles.json"
PROFILE_HASH = "cf305a321f8ebda27006e65d0efcb61388e448c88980b0e935d45875cda02560"
BASELINE_HASH = "446b7ceb3a2e24bef68070712af2f719f26ed457c671212472cacc4d1ff13d62"
MANIFEST = ROOT / "public/brand/catalog-materials.manifest.json"
WIDTHS = (320, 640, 960, 1536)


def digest(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if PIL.__version__ != "12.3.0" or not all(features.check(f) for f in ("avif", "webp")):
        raise SystemExit("Use pinned Pillow 12.3.0 with AVIF and WebP support.")
    profile_bytes = PROFILE_PATH.read_bytes()
    if digest(profile_bytes) != PROFILE_HASH:
        raise SystemExit("Reviewed material profiles changed.")
    baseline_path = ROOT / "public/brand/assets.manifest.json"
    baseline_bytes = baseline_path.read_bytes()
    baseline = json.loads(baseline_bytes)
    if len(baseline["assets"]) != 262 or digest(json.dumps(
        baseline["assets"], ensure_ascii=False, separators=(",", ":")
    ).encode()) != BASELINE_HASH:
        raise SystemExit("Preserved 262-entry brand baseline changed.")
    for asset in baseline["assets"]:
        contents = (ROOT / "public" / asset["path"].lstrip("/")).read_bytes()
        if digest(contents) != asset["sha256"] or len(contents) != asset["bytes"]:
            raise SystemExit("Preserved brand asset integrity failed.")
    if args.write and MANIFEST.exists():
        raise SystemExit("Existing material manifest must not be overwritten.")
    output = []
    for profile in json.loads(profile_bytes):
        master = ROOT / profile["sourceMaster"]
        if digest(master.read_bytes()) != profile["sourceSha256"]:
            raise SystemExit("Native material master changed.")
        with Image.open(master) as image:
            if image.mode != "RGB" or image.size != (1536, 1024):
                raise SystemExit("Master must remain complete 1536x1024 RGB.")
            source = image.copy()
        for width in WIDTHS:
            height = round(1024 * width / 1536)
            resized = source if width == 1536 else source.resize(
                (width, height), Image.Resampling.LANCZOS
            )
            for extension, format_name, options in (
                ("avif", "AVIF", {"quality": 94, "speed": 6, "subsampling": "4:4:4", "max_threads": 1}),
                ("webp", "WEBP", {"lossless": True, "method": 6, "exact": True}),
            ):
                buffer = io.BytesIO()
                resized.save(buffer, format_name, **options)
                contents = buffer.getvalue()
                with Image.open(io.BytesIO(contents)) as decoded:
                    if decoded.size != resized.size:
                        raise SystemExit("Encoded dimensions differ.")
                    difference = ImageChops.difference(resized, decoded.convert("RGB"))
                    if extension == "webp" and difference.getbbox() is not None:
                        raise SystemExit("Lossless WebP pixel integrity failed.")
                    rms = math.sqrt(sum(v * v for v in ImageStat.Stat(difference).rms) / 3)
                    if extension == "avif" and rms > 255 * 10 ** (-36 / 20):
                        raise SystemExit("AVIF quality is below reviewed 36dB threshold.")
                family = profile["family"]
                relative = f"/brand/catalog-materials/{family}/{family}-{width}-v1.{extension}"
                metadata = {k: v for k, v in profile.items() if k != "family"}
                metadata.update(path=relative, width=width, height=height,
                                mimeType="image/" + extension,
                                bytes=len(contents), sha256=digest(contents))
                output.append((metadata, contents))
    if args.write:
        for asset, contents in output:
            target = ROOT / "public" / asset["path"].lstrip("/")
            if target.exists():
                raise SystemExit("A material derivative already exists.")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
        MANIFEST.write_text(json.dumps({
            "schemaVersion": 1,
            "assetVersion": "2026.10.06-catalog-materials-v1",
            "sourcePolicy": "Native generated pixels contain no production copy; public files are optimized full-frame derivatives. Categories convey materials only, never operating product affiliation.",
            "assets": [a for a, _ in output],
        }, ensure_ascii=False, indent=2) + "\n")
    if baseline_path.read_bytes() != baseline_bytes:
        raise SystemExit("Brand baseline metadata changed during encoding.")
    print(json.dumps({"write": args.write, "derivatives": len(output),
                      "existing_assets_unchanged": 262,
                      "native_masters_unchanged": 3}))


if __name__ == "__main__":
    main()
