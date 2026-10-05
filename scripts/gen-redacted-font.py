"""
Generate src/app/fonts/ledgr-redacted.woff2 — the squiggle glyphs privacy
mode draws instead of dollar amounts (see MASKED_AMOUNT in
src/lib/utils/format.ts).

The font only maps a few Private Use Area code points (U+E000–U+E007). Each
glyph is a digit-width scribble: irregular up/down strokes spanning the
digit height, like a number crossed out by hand. Strokes start and end at
mid-height heading right, so a run of them joins into one continuous
squiggle.

One-off generator; the .woff2 is committed. Re-run only to change the shape:

    python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
    /tmp/fontenv/bin/python scripts/gen-redacted-font.py
"""

import math
import random
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
STROKE = 46
ADVANCE = 600  # IBM Plex's digit width, so masks space like real numbers
MID_Y = 340  # half of Plex's digit height; every stroke starts and ends here
SAMPLES = 10  # spline samples per control-point segment
OUT = Path(__file__).resolve().parent.parent / "src/app/fonts/ledgr-redacted.woff2"


def scribble(seed: int) -> list[tuple[float, float]]:
    """Centreline of one scribbled-over digit: 3-4 irregular up/down
    strokes spanning the digit height (baseline to ~cap height), no letter
    shapes. Seeded so the committed font is reproducible."""
    rng = random.Random(seed)
    swings = rng.choice([3, 4])
    pts = [(0.0, MID_Y)]
    for i in range(swings):
        x = ADVANCE * (i + 0.5 + rng.uniform(-0.12, 0.12)) / swings
        up = i % 2 == (seed % 2)
        y = rng.uniform(560, 690) if up else rng.uniform(-10, 110)
        pts.append((x, y))
    pts.append((float(ADVANCE), MID_Y))
    return pts


# (code point, centreline). The mask picks a pseudo-random sequence of these
# per amount (maskedAmount in format.ts), so no two amounts look alike.
VARIANTS = [(0xE000 + i, scribble(i)) for i in range(8)]


def catmull_rom(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Smooth curve through the control points, leaving and arriving
    horizontally (phantom end points) so neighbouring glyphs join cleanly."""
    (x0, y0), (xn, yn) = points[0], points[-1]
    pts = [(x0 - 80, y0)] + points + [(xn + 80, yn)]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for j in range(SAMPLES):
            t = j / SAMPLES
            t2, t3 = t * t, t * t * t
            out.append(
                tuple(
                    0.5
                    * (
                        2 * p1[k]
                        + (-p0[k] + p2[k]) * t
                        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                        + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
                    )
                    for k in range(2)
                )
            )
    out.append(points[-1])
    return out


def draw_glyph(pen: TTGlyphPen, control: list[tuple[float, float]]) -> None:
    # One small quad per centreline segment, all wound the same way, so the
    # nonzero fill rule keeps self-crossing loops solid (a single offset
    # outline would punch a hole where the stroke crosses itself).
    pts = catmull_rom(control)
    half = STROKE / 2
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy) or 1
        # Extend each segment slightly along its direction to close the
        # wedge gaps between neighbouring quads on the outside of curves.
        ex, ey = dx / length * half * 0.5, dy / length * half * 0.5
        nx, ny = -dy / length * half, dx / length * half
        quad = [
            (x0 - ex + nx, y0 - ey + ny),
            (x1 + ex + nx, y1 + ey + ny),
            (x1 + ex - nx, y1 + ey - ny),
            (x0 - ex - nx, y0 - ey - ny),
        ]
        area = sum(
            quad[i][0] * quad[(i + 1) % 4][1] - quad[(i + 1) % 4][0] * quad[i][1]
            for i in range(4)
        )
        if area > 0:  # TrueType outer contours run clockwise
            quad.reverse()
        pen.moveTo(tuple(round(c) for c in quad[0]))
        for p in quad[1:]:
            pen.lineTo(tuple(round(c) for c in p))
        pen.closePath()


def main() -> None:
    names = [".notdef"] + [f"loop{i}" for i in range(len(VARIANTS))]
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (ADVANCE, 0)}
    cmap = {}
    for i, (cp, control) in enumerate(VARIANTS):
        pen = TTGlyphPen(None)
        draw_glyph(pen, control)
        glyph = pen.glyph()
        glyph.recalcBounds(None)
        glyphs[names[i + 1]] = glyph
        metrics[names[i + 1]] = (ADVANCE, glyph.xMin)
        cmap[cp] = names[i + 1]

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=900, descent=-250)
    fb.setupNameTable({"familyName": "Ledgr Redacted", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=900, sTypoDescender=-250, usWinAscent=900, usWinDescent=250)
    fb.setupPost()
    fb.font.flavor = "woff2"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fb.save(str(OUT))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
