# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "Pillow",
# ]
# ///

"""Generate macOS-compatible tray template icons from the Mico tray source."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "tray-source.png"
OUTPUT = ROOT / "build"
TARGET_SIZES = {"": 22, "@2x": 44, "@3x": 66}
PADDING = 0.06
DOT_CENTER = (0.86, 0.16)
DOT_RADIUS = 0.13


def load_alpha_mask() -> Image.Image:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Missing tray source: {SOURCE}")

    alpha = Image.open(SOURCE).convert("RGBA").getchannel("A")
    if alpha.getbbox() is None:
        raise ValueError(f"Tray source has no visible pixels: {SOURCE}")
    return alpha


def fit_mask(mask: Image.Image, size: int) -> Image.Image:
    bounding_box = mask.getbbox()
    if bounding_box is None:
        raise ValueError("Tray source has no visible pixels")

    cropped = mask.crop(bounding_box)
    square_size = max(cropped.size)
    square = Image.new("L", (square_size, square_size))
    square.paste(cropped, ((square_size - cropped.width) // 2, (square_size - cropped.height) // 2))

    inner_size = max(1, round(size * (1 - 2 * PADDING)))
    resized = square.resize((inner_size, inner_size), Image.Resampling.LANCZOS)
    output = Image.new("L", (size, size))
    output.paste(resized, ((size - inner_size) // 2, (size - inner_size) // 2))
    return output


def make_template(mask: Image.Image) -> Image.Image:
    template = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    template.putalpha(mask)
    return template


def add_unread_dot(template: Image.Image) -> Image.Image:
    output = template.copy()
    size = output.width
    scale = 4
    dot_mask = Image.new("L", (size * scale, size * scale))
    center_x = DOT_CENTER[0] * size * scale
    center_y = DOT_CENTER[1] * size * scale
    radius = DOT_RADIUS * size * scale
    ImageDraw.Draw(dot_mask).ellipse(
        (center_x - radius, center_y - radius, center_x + radius, center_y + radius), fill=255
    )
    dot_mask = dot_mask.resize((size, size), Image.Resampling.LANCZOS)

    alpha = output.getchannel("A")
    alpha.paste(dot_mask, mask=dot_mask)
    output.putalpha(alpha)
    return output


def main() -> None:
    alpha = load_alpha_mask()
    for suffix, size in TARGET_SIZES.items():
        template = make_template(fit_mask(alpha, size))
        template.save(OUTPUT / f"tray-template{suffix}.png")
        add_unread_dot(template).save(OUTPUT / f"tray-template-unread{suffix}.png")
        print(f"built tray-template{suffix}.png + unread variant ({size}x{size})")


if __name__ == "__main__":
    main()
