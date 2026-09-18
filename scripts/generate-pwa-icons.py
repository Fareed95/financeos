#!/usr/bin/env python3
"""Rasterize FinanceOS PWA icons and iOS splash screens."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path("/workspace/public")
BG = (12, 12, 13, 255)
INK = (236, 232, 225, 255)
MUTED = (156, 153, 146, 255)
GOLD = (196, 165, 116, 255)


def rounded_mask(size: int, radius: int) -> Image.Image:
    scale = 4
    big = size * scale
    r = radius * scale
    m = Image.new("L", (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, big - 1, big - 1), radius=r, fill=255)
    return m.resize((size, size), Image.Resampling.LANCZOS)


def draw_mark(draw: ImageDraw.ImageDraw, size: int, pad: float) -> None:
    inner = size - pad * 2
    x = pad + inner * 0.22
    y0 = pad + inner * 0.28
    gap = inner * 0.18
    h = max(size * 0.055, 3)
    w1 = inner * 0.56
    w2 = inner * 0.38
    w3 = inner * 0.48
    r = h / 2

    def bar(x0, y, w, fill):
        draw.rounded_rectangle((x0, y, x0 + w, y + h), radius=r, fill=fill)

    bar(x, y0, w1, INK)
    bar(x, y0 + gap, w2, INK)
    bar(x, y0 + gap * 2, w3, MUTED)
    tick = max(h * 1.15, 4)
    tx = x + w1 + inner * 0.04
    ty = y0 + h / 2 - tick / 2
    draw.rounded_rectangle((tx, ty, tx + tick, ty + tick), radius=tick * 0.28, fill=GOLD)


def make_icon(size: int, *, maskable: bool = False, rounded: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)
    pad = size * (0.22 if maskable else 0.0)
    draw_mark(draw, size, pad)
    if rounded:
        mask = rounded_mask(size, int(size * 0.22))
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        return out
    return img


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def make_splash(w: int, h: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), BG)
    icon_size = int(min(w, h) * 0.18)
    icon = make_icon(icon_size, rounded=True)
    ix = (w - icon_size) // 2
    iy = int(h * 0.38) - icon_size // 2
    img.paste(icon, (ix, iy), icon)

    draw = ImageDraw.Draw(img)
    f = font(max(28, int(w * 0.055)))
    text = "FinanceOS"
    bbox = draw.textbbox((0, 0), text, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((w - tw) / 2, iy + icon_size + int(h * 0.028)), text, font=f, fill=INK)
    sub = font(max(16, int(w * 0.028)))
    label = "Your ledger"
    bbox = draw.textbbox((0, 0), label, font=sub)
    sw = bbox[2] - bbox[0]
    draw.text(((w - sw) / 2, iy + icon_size + int(h * 0.028) + th + 14), label, font=sub, fill=MUTED)
    return img


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path, "PNG", optimize=True)
    print(f"wrote {path} {img.size}")


def main() -> None:
    save(make_icon(180), ROOT / "__grok" / "icon-180.png")
    save(make_icon(192), ROOT / "icon-192.png")
    save(make_icon(512), ROOT / "icon-512.png")
    save(make_icon(512, maskable=True), ROOT / "icon-512-maskable.png")
    save(make_icon(180, rounded=True), ROOT / "apple-touch-icon.png")

    for w, h in (
        (1290, 2796),
        (1170, 2532),
        (1179, 2556),
        (1284, 2778),
        (1242, 2688),
        (828, 1792),
        (750, 1334),
        (1488, 2266),
        (1668, 2388),
        (2048, 2732),
    ):
        save(make_splash(w, h), ROOT / "splash" / f"{w}x{h}.png")


if __name__ == "__main__":
    main()
