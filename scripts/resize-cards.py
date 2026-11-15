"""Makes the web-sized card images in site/cards/ from the scans in assets/cards-src/.

The widget shows cards at most ~190 CSS px wide (380 device px on a 2x screen) and the
email at 120px, so 480px wide is plenty. Progressive JPEG, quality 80, roughly 110-120 KB each (the scans have paper grain).

Needs Pillow:  pip install pillow
Usage:         python -I scripts/resize-cards.py [--width=480] [--quality=80]
"""
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Pillow is not installed. Run: pip install pillow")

root = Path(__file__).resolve().parent.parent
src = root / "assets" / "cards-src"
dst = root / "site" / "cards"


def opt(name, default):
    prefix = f"--{name}="
    for a in sys.argv[1:]:
        if a.startswith(prefix):
            return a[len(prefix):]
    return default


width = int(opt("width", 480))
quality = int(opt("quality", 80))

files = sorted(src.glob("*.jpg"))
if not files:
    sys.exit(f"No source images in {src}. Run: node scripts/download-cards.mjs")

dst.mkdir(parents=True, exist_ok=True)
total = 0
for p in files:
    im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    out = dst / p.name
    im.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    total += out.stat().st_size

print(f"wrote {len(files)} cards to {dst} at {width}px wide, {total / 1024 / 1024:.1f} MB total")
if len(files) != 78:
    print(f"warning: expected 78 source images, found {len(files)}")
