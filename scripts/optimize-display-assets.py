"""Create small web display copies while preserving the original brand assets."""

from pathlib import Path
from PIL import Image

assets = Path(__file__).resolve().parent.parent / "public" / "assets"
for name, max_width in (
    ("MOT-U125-body-proportional", 840),
    ("MHO-C404-body-white", 640),
    ("indoor-pv", 640),
):
    source = assets / f"{name}.png"
    target = assets / f"{name}-display.webp"
    with Image.open(source) as image:
        image.thumbnail((max_width, max_width), Image.Resampling.LANCZOS)
        image.save(target, format="WEBP", quality=84, method=6)
    print(f"{target.name}: {target.stat().st_size} bytes")
