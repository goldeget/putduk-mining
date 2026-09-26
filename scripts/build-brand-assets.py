"""Build deterministic responsive PUTDUK raster assets from approved masters.

This script never creates copy or typography. Korean and Latin brand text remain
in HTML or SVG files where spelling can be reviewed. Raster outputs are visual
layers only.
"""

from __future__ import annotations

import hashlib
import json
import math
import mimetypes
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
BRAND = PUBLIC / "brand"
RANKS = PUBLIC / "ranks"
GENERATED_MASTERS = ROOT / "docs" / "design" / "generated-masters"
VERSION = "2026.09.27-v1"

MASCOT_MASTER = GENERATED_MASTERS / "putduk-miner-master-v1.png"
WORLD_MASTER = GENERATED_MASTERS / "putduk-orbital-earth-master-v1.png"

GOLD = (246, 200, 91, 255)
GOLD_DEEP = (139, 87, 23, 255)
INK = (5, 6, 7, 255)
IVORY = (248, 243, 232, 255)


def ensure_sources() -> None:
    sources = [MASCOT_MASTER, WORLD_MASTER]
    sources.extend(
        GENERATED_MASTERS
        / "ranks"
        / f"rank-{index:02d}"
        / "planet-master-v1.png"
        for index in range(1, 7)
    )
    missing = [str(path.relative_to(ROOT)) for path in sources if not path.exists()]
    if missing:
        raise SystemExit(f"Missing approved master asset(s): {', '.join(missing)}")


def alpha_crop(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    box = rgba.getbbox()
    return rgba.crop(box) if box else rgba


def contain(image: Image.Image, size: tuple[int, int], scale: float = 1.0) -> Image.Image:
    target = (max(1, round(size[0] * scale)), max(1, round(size[1] * scale)))
    result = image.copy()
    result.thumbnail(target, Image.Resampling.LANCZOS)
    return result


def cover(image: Image.Image, size: tuple[int, int], focal_x: float = 0.5) -> Image.Image:
    width, height = size
    source_ratio = image.width / image.height
    target_ratio = width / height
    if source_ratio > target_ratio:
        resized_height = height
        resized_width = math.ceil(height * source_ratio)
    else:
        resized_width = width
        resized_height = math.ceil(width / source_ratio)
    resized = image.resize((resized_width, resized_height), Image.Resampling.LANCZOS)
    left = round((resized_width - width) * min(1.0, max(0.0, focal_x)))
    top = max(0, (resized_height - height) // 2)
    return resized.crop((left, top, left + width, top + height))


def save_modern(image: Image.Image, base: Path, *, alpha: bool = False) -> None:
    base.parent.mkdir(parents=True, exist_ok=True)
    source = image.convert("RGBA" if alpha else "RGB")
    source.save(base.with_suffix(".webp"), "WEBP", quality=90, method=6, lossless=False)
    source.save(base.with_suffix(".avif"), "AVIF", quality=72, speed=8)


def radial_background(size: int, light: bool) -> Image.Image:
    start = (255, 252, 244) if light else (6, 6, 7)
    end = (244, 226, 183) if light else (39, 27, 10)
    gradient = Image.radial_gradient("L").resize((size, size), Image.Resampling.BICUBIC)
    canvas = ImageOps.colorize(gradient, black=end, white=start).convert("RGBA")
    draw = ImageDraw.Draw(canvas)
    inset = max(2, size // 64)
    draw.rounded_rectangle(
        (inset, inset, size - inset - 1, size - inset - 1),
        radius=size // 5,
        outline=(184, 123, 32, 150) if light else (246, 200, 91, 180),
        width=max(2, size // 128),
    )
    return canvas


def mascot_head(mascot: Image.Image) -> Image.Image:
    cropped = alpha_crop(mascot)
    return cropped.crop((0, 0, cropped.width, round(cropped.height * 0.64)))


def paste_center(canvas: Image.Image, layer: Image.Image, y_offset: int = 0) -> None:
    x = (canvas.width - layer.width) // 2
    y = (canvas.height - layer.height) // 2 + y_offset
    canvas.alpha_composite(layer, (x, y))


def build_pwa(mascot: Image.Image) -> None:
    head = mascot_head(mascot)
    outputs = [
        (192, False, False, "putduk-pwa-dark-192"),
        (512, False, False, "putduk-pwa-dark-512"),
        (192, True, False, "putduk-pwa-light-192"),
        (512, True, False, "putduk-pwa-light-512"),
        (512, False, True, "putduk-pwa-maskable-512"),
    ]
    for size, light, maskable, name in outputs:
        canvas = radial_background(size, light)
        subject = contain(head, (size, size), 0.58 if maskable else 0.76)
        paste_center(canvas, subject, round(size * 0.035))
        canvas.convert("RGB").save(
            BRAND / "pwa" / f"{name}.png", "PNG", optimize=True
        )


def draw_favicon(size: int, light: bool = False) -> Image.Image:
    scale = size / 128
    canvas = radial_background(size, light)
    draw = ImageDraw.Draw(canvas)

    def points(values: list[tuple[float, float]]) -> list[tuple[int, int]]:
        return [(round(x * scale), round(y * scale)) for x, y in values]

    draw.ellipse((26 * scale, 8 * scale, 63 * scale, 42 * scale), fill=GOLD)
    draw.ellipse((62 * scale, 8 * scale, 101 * scale, 42 * scale), fill=GOLD)
    draw.rounded_rectangle(
        (20 * scale, 40 * scale, 108 * scale, 108 * scale),
        radius=28 * scale,
        fill=GOLD,
    )
    draw.rounded_rectangle(
        (29 * scale, 57 * scale, 99 * scale, 105 * scale),
        radius=22 * scale,
        fill=INK,
        outline=GOLD_DEEP,
        width=max(1, round(3 * scale)),
    )
    draw.ellipse((47 * scale, 70 * scale, 59 * scale, 94 * scale), fill=(255, 255, 255, 255))
    draw.line(
        points([(82, 73), (70, 82), (82, 91)]),
        fill=(255, 255, 255, 255),
        width=max(1, round(7 * scale)),
        joint="curve",
    )
    return canvas


def build_favicons() -> None:
    dark = draw_favicon(512)
    light = draw_favicon(512, True)
    for size in (16, 32, 48):
        dark.resize((size, size), Image.Resampling.LANCZOS).convert("RGB").save(
            BRAND / "favicon" / f"favicon-{size}.png", optimize=True
        )
    dark.convert("RGB").save(
        BRAND / "favicon" / "favicon-dark-512.png", optimize=True
    )
    light.convert("RGB").save(
        BRAND / "favicon" / "favicon-light-512.png", optimize=True
    )
    dark.convert("RGB").save(
        BRAND / "favicon" / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )


def build_mascot_variants(mascot: Image.Image) -> None:
    cropped = alpha_crop(mascot)
    for width in (384, 768, 1024):
        height = round(cropped.height * width / cropped.width)
        resized = cropped.resize((width, height), Image.Resampling.LANCZOS)
        save_modern(
            resized,
            BRAND / "mascot" / f"putduk-miner-{width}-v1",
            alpha=True,
        )

    large = contain(cropped, (1024, 1400))
    alpha = large.getchannel("A")
    outline = alpha.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(2))
    outlined = Image.new("RGBA", large.size, (0, 0, 0, 0))
    outlined.putalpha(outline)
    outlined.paste((22, 18, 12, 220), (0, 0, *large.size), outline)
    outlined.alpha_composite(large)
    save_modern(outlined, BRAND / "mascot" / "putduk-miner-light-v1", alpha=True)
    save_modern(large, BRAND / "mascot" / "putduk-miner-dark-v1", alpha=True)


def build_world_variants(world: Image.Image) -> None:
    for width in (960, 1600, 2400):
        size = (width, round(width * 9 / 16))
        frame = cover(world, size, 0.62)
        save_modern(frame, BRAND / "worlds" / f"orbital-earth-{width}-v1")


def darken(image: Image.Image, opacity: int) -> Image.Image:
    result = image.convert("RGBA")
    overlay = Image.new("RGBA", result.size, (0, 0, 0, opacity))
    return Image.alpha_composite(result, overlay)


def build_scene(
    world: Image.Image,
    mascot: Image.Image,
    size: tuple[int, int],
    *,
    mascot_fraction: float,
    focal_x: float,
) -> Image.Image:
    background = cover(world, size, focal_x).convert("RGBA")
    blurred = background.filter(ImageFilter.GaussianBlur(max(1, size[0] // 180)))
    background = Image.blend(blurred, background, 0.76)
    background = darken(background, 42)
    subject = contain(alpha_crop(mascot), size, mascot_fraction)
    x = max(0, size[0] - subject.width - round(size[0] * 0.035))
    y = max(0, size[1] - subject.height + round(size[1] * 0.05))
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    shadow_alpha = subject.getchannel("A").filter(ImageFilter.GaussianBlur(max(4, size[0] // 120)))
    shadow_layer = Image.new("RGBA", subject.size, (0, 0, 0, 160))
    shadow_layer.putalpha(shadow_alpha)
    shadow.alpha_composite(shadow_layer, (x + round(size[0] * 0.008), y + round(size[1] * 0.008)))
    background.alpha_composite(shadow)
    background.alpha_composite(subject, (x, y))
    return background


def build_campaign_derivatives(world: Image.Image, mascot: Image.Image) -> None:
    splash_sizes = {
        "mobile": (1290, 2796),
        "tablet": (2048, 2732),
        "desktop": (2560, 1600),
    }
    for label, size in splash_sizes.items():
        fraction = 0.54 if label == "mobile" else 0.48
        scene = build_scene(world, mascot, size, mascot_fraction=fraction, focal_x=0.66)
        save_modern(scene, BRAND / "splash" / f"putduk-splash-{label}-v1")

    og = build_scene(world, mascot, (1200, 630), mascot_fraction=0.73, focal_x=0.64)
    og.convert("RGB").save(BRAND / "og" / "putduk-og-base-v1.png", optimize=True)
    save_modern(og, BRAND / "og" / "putduk-og-base-v1")

    social = build_scene(world, mascot, (1080, 1080), mascot_fraction=0.62, focal_x=0.63)
    social.convert("RGB").save(
        BRAND / "social" / "putduk-social-square-v1.png", optimize=True
    )
    save_modern(social, BRAND / "social" / "putduk-social-square-v1")


def build_notification_badge() -> None:
    size = 384
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((74, 20, 190, 124), fill=255)
    draw.ellipse((188, 20, 310, 124), fill=255)
    draw.rounded_rectangle((58, 112, 326, 330), radius=104, fill=255)
    draw.rounded_rectangle((88, 172, 296, 326), radius=76, fill=0)
    draw.ellipse((142, 210, 178, 282), fill=255)
    draw.line(((248, 216), (210, 250), (248, 284)), fill=255, width=26)
    badge = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    badge.putalpha(mask)
    badge.resize((96, 96), Image.Resampling.LANCZOS).save(
        BRAND / "notification" / "putduk-notification-badge-96.png",
        optimize=True,
    )


def build_rank_variants() -> None:
    for index in range(1, 7):
        directory = RANKS / f"rank-{index:02d}"
        master = alpha_crop(
            Image.open(
                GENERATED_MASTERS
                / "ranks"
                / f"rank-{index:02d}"
                / "planet-master-v1.png"
            )
        )
        for size in (128, 256, 512):
            layer = contain(master, (size, size), 0.94)
            canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            paste_center(canvas, layer)
            save_modern(canvas, directory / f"planet-{size}-v1", alpha=True)


def asset_alt(path: Path) -> str:
    value = path.as_posix()
    if "/ranks/" in value:
        rank = next(part for part in path.parts if part.startswith("rank-"))
        return f"퍼뜩 {rank} 행성 랭크 엠블럼"
    if "/mascot/" in value or "/pwa/" in value:
        return "금빛 광부 헬멧과 새싹을 쓴 퍼뜩 마스코트"
    if "/worlds/" in value or "/splash/" in value or "/og/" in value or "/social/" in value:
        return "금빛 궤도와 광물이 빛나는 밤의 지구 채굴 세계"
    if "/notification/" in value:
        return "퍼뜩 알림 배지"
    return "퍼뜩 브랜드 자산"


def build_manifest() -> None:
    roots = [BRAND, RANKS]
    files = sorted(
        path
        for root in roots
        for path in root.rglob("*")
        if path.is_file() and path.name != "assets.manifest.json"
    )
    assets = []
    for path in files:
        relative = "/" + path.relative_to(PUBLIC).as_posix()
        mime_types = {
            ".avif": "image/avif",
            ".ico": "image/x-icon",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".webp": "image/webp",
        }
        record: dict[str, object] = {
            "path": relative,
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "mimeType": mime_types.get(
                path.suffix.lower(),
                mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            ),
            "alt": asset_alt(path),
        }
        if path.suffix.lower() in {".png", ".webp", ".avif", ".ico"}:
            with Image.open(path) as image:
                record["width"] = image.width
                record["height"] = image.height
        if "-light" in path.stem:
            record["theme"] = "light"
        elif "-dark" in path.stem:
            record["theme"] = "dark"
        elif "maskable" in path.stem:
            record["purpose"] = "maskable"
        else:
            record["theme"] = "system"
        assets.append(record)

    manifest = {
        "schemaVersion": 1,
        "assetVersion": VERSION,
        "generatedAt": "2026-09-27T00:00:00Z",
        "sourcePolicy": "Canonical references live under docs/design/visual-references; lossless generated masters live under docs/design/generated-masters; public files are optimized derivatives and generated pixels contain no production copy.",
        "assets": assets,
    }
    (BRAND / "assets.manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    ensure_sources()
    if len(sys.argv) == 3 and sys.argv[1] == "--only":
        if sys.argv[2] != "notification":
            raise SystemExit("Supported partial build: --only notification")
        build_notification_badge()
        build_manifest()
        print(f"Built PUTDUK notification asset {VERSION}")
        return
    mascot = Image.open(MASCOT_MASTER).convert("RGBA")
    world = Image.open(WORLD_MASTER).convert("RGB")
    build_mascot_variants(mascot)
    build_world_variants(world)
    build_pwa(mascot)
    build_favicons()
    build_campaign_derivatives(world, mascot)
    build_notification_badge()
    build_rank_variants()
    build_manifest()
    print(f"Built PUTDUK asset system {VERSION}")


if __name__ == "__main__":
    main()
