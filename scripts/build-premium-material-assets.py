"""Encode the owner-delegated premium material pair without modifying its pixels.

Dry run by default. --write adds one independent current asset manifest; the
historic v18 collection and current sprout-P identity remain byte-identical.
"""
from __future__ import annotations
import argparse, hashlib, io, json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MASTER_DIR = ROOT / "docs/design/generated-masters/premium-material-2026-10-14"
PREFIX = "/brand/premium/20261014/"
MANIFEST = ROOT / "public/brand/premium.manifest.json"
VERSION = "2026.10.14-premium-material-v1"
MASTERS = {
    "dark": "52dda29af044c5eee58fc6b0afa869374c55668da1488bc4407115c6ff657529",
    "light": "f9e5097be7748e50142cc6d4e2363a4d4f075ac2572175a87b56428b6b525e08",
}
PRESERVED = {
    "public/brand/assets.manifest.json": "96ef1731f792d3e7bbf306cf44f0042e2809a8851185affda61160179d14e624",
    "public/brand/identity.manifest.json": "8df270c14d28f2515b81468de58d9cd7459c4f22fae1628da2876034ce08d787",
}
def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    import PIL
    from PIL import Image, ImageChops, ImageStat, features
    assert PIL.__version__ == "12.3.0"
    assert features.check("avif") and features.check("webp")
    for name, expected in PRESERVED.items():
        assert digest((ROOT / name).read_bytes()) == expected
    products = []
    assets = []
    for theme, expected in MASTERS.items():
        source = MASTER_DIR / f"premium-material-{theme}-master-v1.png"
        assert digest(source.read_bytes()) == expected
        with Image.open(source) as opened:
            assert opened.mode == "RGB" and opened.size == (2164, 727)
            master = opened.copy()
        for width in (640, 1280):
            height = round(master.height * width / master.width)
            resized = master.resize((width, height), Image.Resampling.LANCZOS)
            for extension in ("avif", "webp"):
                buffer = io.BytesIO()
                if extension == "webp":
                    resized.save(buffer, "WEBP", lossless=True, method=6)
                else:
                    resized.save(buffer, "AVIF", quality=94, subsampling="4:4:4", speed=6)
                data = buffer.getvalue()
                with Image.open(io.BytesIO(data)) as decoded:
                    assert decoded.size == resized.size
                    pixels = decoded.convert("RGB")
                    delta = ImageChops.difference(resized, pixels)
                    mse = sum(v * v for v in ImageStat.Stat(delta).rms) / 3
                    if extension == "webp":
                        assert delta.getbbox() is None
                    else:
                        assert mse == 0 or 10 * math.log10(255 * 255 / mse) >= 40
                name = f"premium-material-{theme}-{width}-v1.{extension}"
                runtime = ROOT / "public" / PREFIX.lstrip("/") / name
                assets.append({
                    "path": PREFIX + name, "bytes": len(data), "sha256": digest(data),
                    "mimeType": "image/" + extension, "width": width, "height": height,
                    "theme": theme, "purpose": "decorative-heading-material",
                    "alt": "유리와 금속의 곡면에 은은한 금빛이 비치는 장식", 
                    "sourceMaster": source.relative_to(ROOT).as_posix(), "sourceSha256": expected,
                })
                products.append((runtime, data))
    copies = []
    for asset, (_, data) in zip(assets, products):
        target = ROOT / "apps/admin/public" / asset["path"].lstrip("/")
        products.append((target, data))
        copies.append({"path": target.relative_to(ROOT).as_posix(), "source": asset["path"], "bytes": asset["bytes"], "sha256": asset["sha256"]})
    manifest = {"schemaVersion": 1, "assetVersion": VERSION,
        "reviewScope": "Owner-delegated 2026-10-14 premium platform presentation. Headings and empty AI only; no identity replacement, economic authority or product-completion claim.",
        "preservedManifests": PRESERVED, "assets": assets, "adminPublicCopies": copies}
    encoded = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    if args.write:
        for target, data in products + [(MANIFEST, encoded)]:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if target == MANIFEST:
                    # Formatting is not regeneration: keep existing manifest bytes.
                    assert json.loads(target.read_bytes()) == manifest, "Refuse to replace different manifest metadata"
                else:
                    assert target.read_bytes() == data, "Refuse to replace a versioned asset: " + target.relative_to(ROOT).as_posix()
            else:
                target.write_bytes(data)
    print(json.dumps({"mode": "write" if args.write else "dry-run", "assets": len(assets), "bytes": sum(a["bytes"] for a in assets), "preservedManifests": True}))

if __name__ == "__main__":
    main()
