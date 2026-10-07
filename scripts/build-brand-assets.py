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
VERSION = "2026.10.06-v17"

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


LOGIN_ALT_BY_PATH = {
    f"/brand/scenes/{family}/{family}-{width}-v1.{extension}": alt
    for family, widths, alt in [('login-wafer-dark', [480, 640, 941], '짙은 푸른 유리 공장 안에서 원형 웨이퍼와 금빛 수직 광선이 빛나는 세로 로그인 장면'), ('login-semiconductor-dark', [960, 1280, 1536, 1920], '짙은 푸른 반도체 공장 안에서 메모리 타워와 로봇 팔이 빛나고 오른쪽이 비워진 로그인 장면'), ('login-semiconductor-light', [960, 1280, 1536, 1920], '밝은 유리 반도체 공장 안에서 메모리 타워와 로봇 팔이 빛나고 오른쪽이 비워진 로그인 장면')]
    for width in widths for extension in ("avif", "webp")
}


GIFT_ALT_BY_PATH = {
    f"/brand/scenes/home-event-gift/home-event-gift-{width}-v1.{extension}": '짙은 푸른 공간의 오른쪽에 금빛 리본을 두른 세 선물 상자가 빛나는 홈 이벤트 장면'
    for width in (480, 960, 1280, 1920) for extension in ("avif", "webp")
}


MINING_ALT_BY_PATH = {
    f"/brand/scenes/{family}/{family}-{width}-v1.{extension}": alt
    for family, widths, alt in [('mining-semiconductor-mobile-dark', [480, 640, 941], '짙은 푸른 반도체 공장 안에서 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 채굴 장면'), ('mining-semiconductor-desktop-dark', [960, 1280, 1536, 1920], '짙은 푸른 반도체 공장 안에서 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나고 오른쪽이 비워진 넓은 채굴 장면'), ('mining-semiconductor-desktop-light', [960, 1280, 1536, 1920], '밝은 유리 반도체 공장 안에서 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나고 오른쪽이 비워진 넓은 채굴 장면')]
    for width in widths for extension in ("avif", "webp")
}


WALLET_ALT_BY_PATH = {
    f"/brand/scenes/{family}/{family}-{width}-v1.{extension}": alt
    for family, widths, alt in [('wallet-vault-mobile-dark', [480, 640, 941], '짙은 푸른 반도체 공장 오른쪽에 금빛 테두리의 금고 문이 빛나는 세로 지갑 장면'), ('wallet-vault-desktop-dark', [960, 1280, 1536, 1920], '짙은 푸른 반도체 공장 오른쪽에 둥근 금고 문이 빛나고 왼쪽이 비워진 넓은 지갑 장면'), ('wallet-chip-mobile-light', [480, 640, 940], '밝은 유리 반도체 공장 오른쪽에 금빛 반도체 칩과 회로가 빛나는 세로 지갑 장면'), ('wallet-chip-desktop-light', [960, 1280, 1536, 1920], '밝은 유리 반도체 공장 오른쪽에 금빛 반도체 칩과 회로가 빛나고 왼쪽이 비워진 넓은 지갑 장면')]
    for width in widths for extension in ("avif", "webp")
}


SIGNUP_ALT_BY_PATH = {'/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-640-v1.webp': '짙은 푸른 반도체 공장에서 금빛 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 가입 장면', '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-640-v1.avif': '짙은 푸른 반도체 공장에서 금빛 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 가입 장면', '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-941-v1.webp': '짙은 푸른 반도체 공장에서 금빛 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 가입 장면', '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-480-v1.avif': '짙은 푸른 반도체 공장에서 금빛 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 가입 장면', '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-480-v1.webp': '짙은 푸른 반도체 공장에서 금빛 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 가입 장면', '/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-941-v1.avif': '짙은 푸른 반도체 공장에서 금빛 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 가입 장면'}


PRODUCTS_ALT_BY_PATH = {'/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-960-v1.webp': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-640-v1.webp': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-960-v1.avif': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1536-v1.avif': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1280-v1.avif': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1280-v1.webp': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-640-v1.avif': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1536-v1.webp': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-480-v1.avif': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-480-v1.webp': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1920-v1.avif': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면', '/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-1920-v1.webp': '짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면'}


AI_ALT_BY_PATH = {'/brand/scenes/ai-partner-hero/ai-partner-hero-1920-v1.webp': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-1280-v1.avif': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-1536-v1.webp': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-1536-v1.avif': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-960-v1.webp': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-1280-v1.webp': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-960-v1.avif': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-640-v1.avif': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-1920-v1.avif': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-640-v1.webp': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-480-v1.webp': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면', '/brand/scenes/ai-partner-hero/ai-partner-hero-480-v1.avif': '금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면'}


def asset_alt(path: Path) -> str:
    relative = "/" + path.relative_to(PUBLIC).as_posix()
    if relative in SIGNUP_ALT_BY_PATH:
        return SIGNUP_ALT_BY_PATH[relative]
    if relative in PRODUCTS_ALT_BY_PATH:
        return PRODUCTS_ALT_BY_PATH[relative]
    if relative in AI_ALT_BY_PATH:
        return AI_ALT_BY_PATH[relative]
    if relative in WALLET_ALT_BY_PATH:
        return WALLET_ALT_BY_PATH[relative]
    if relative in MINING_ALT_BY_PATH:
        return MINING_ALT_BY_PATH[relative]
    if relative in GIFT_ALT_BY_PATH:
        return GIFT_ALT_BY_PATH[relative]
    if relative in LOGIN_ALT_BY_PATH:
        return LOGIN_ALT_BY_PATH[relative]
    value = path.as_posix()
    if path.name.startswith("semiconductor-tower-desktop-") and "/scenes/semiconductor-tower-desktop/" in value:
        return "짙은 푸른 반도체 공장 안에서 여섯 층 메모리 타워와 양쪽 로봇 팔이 빛나는 넓은 장면"
    if path.name.startswith("semiconductor-wafer-light-desktop-") and "/scenes/semiconductor-wafer-light-desktop/" in value:
        return "밝은 유리 반도체 공장 안에서 낮고 얇은 원형 웨이퍼와 금빛 수직 광선이 빛나는 넓은 장면"
    if path.name.startswith("gold-category-") and "/scenes/gold-category/" in value:
        return "짙은 푸른 공장 안에서 금빛 금속 막대가 빛나는 중립 골드 카테고리 장면"
    if path.name.startswith("semiconductor-wafer-light-") and "/scenes/semiconductor-wafer-light/" in value:
        return "밝은 유리 반도체 공장 안에서 넓고 낮은 원형 웨이퍼와 금빛 수직 광선이 빛나는 장면"
    if path.name.startswith("semiconductor-tower-") and "/scenes/semiconductor-tower/" in value:
        return "짙은 푸른 반도체 공장 안에서 로봇 팔과 금빛 여섯 층 메모리 타워가 빛나는 장면"
    if path.name.startswith("semiconductor-memory-light-") and "/scenes/semiconductor-memory-light/" in value:
        return "밝은 전시 공간에서 금빛 회로와 푸른 메모리 칩이 빛나는 반도체 시설"
    if path.name.startswith("global-pavilion-") and "/scenes/global-pavilion/" in value:
        return "금빛 도시와 푸른 지구, 금속과 반도체가 놓인 원형 전시 공간"
    if path.name.startswith("semiconductor-memory-") and "/scenes/" in value:
        return "금빛과 푸른빛이 반사되는 반도체 시설과 중앙 추출 장치"
    if path.name.startswith("putduk-ai-help-face-"):
        return "금빛 헬멧과 새싹을 쓴 퍼뜩 AI 도움 얼굴"
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


def build_manifest(*, write: bool = True) -> dict[str, object]:
    manifest_path = BRAND / "assets.manifest.json"
    previous = (
        json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_path.exists()
        else {"assets": []}
    )
    previous_by_path = {asset["path"]: asset for asset in previous["assets"]}
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
        if relative in AI_ALT_BY_PATH or relative in PRODUCTS_ALT_BY_PATH or relative in GIFT_ALT_BY_PATH or relative in {
            f"/brand/scenes/semiconductor-tower/semiconductor-tower-{width}-v1.{format}"
            for width in (640, 960, 1280, 1536) for format in ("avif", "webp")
        } | {
            f"/brand/scenes/gold-category/gold-category-{width}-v1.{format}"
            for width in (320, 640, 960, 1536) for format in ("avif", "webp")
        } | {
            f"/brand/scenes/semiconductor-tower-desktop/semiconductor-tower-desktop-{width}-v1.{format}"
            for width in (960, 1280, 1536, 1920) for format in ("avif", "webp")
        }:
            record["theme"] = "dark"
        elif "-light" in path.stem:
            record["theme"] = "light"
        elif "-dark" in path.stem:
            record["theme"] = "dark"
        elif "maskable" in path.stem:
            record["purpose"] = "maskable"
        else:
            record["theme"] = "system"
        # Review metadata belongs to the exact committed bytes. A different
        # encoding must not inherit approval merely because its path matches.
        prior = previous_by_path.get(relative)
        if prior and prior.get("sha256") == record["sha256"]:
            for key in ("assetVersion", "sourceMaster", "sourceSha256", "reviewScope"):
                if key in prior:
                    record[key] = prior[key]
        assets.append(record)

    assets.sort(key=lambda asset: asset["path"])

    manifest = {
        "schemaVersion": 1,
        "assetVersion": VERSION,
        "generatedAt": "2026-10-06T00:00:00Z",
        "sourcePolicy": "Canonical references live under docs/design/visual-references; lossless generated masters live under docs/design/generated-masters; public files are optimized derivatives and generated pixels contain no production copy.",
        "assets": assets,
    }
    if write:
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return manifest


def main() -> None:
    if sys.argv[1:] == ["--manifest-dry-run"]:
        print(json.dumps(build_manifest(write=False), ensure_ascii=False, indent=2))
        return
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
