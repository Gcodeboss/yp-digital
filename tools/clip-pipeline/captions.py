#!/usr/bin/env python3
r"""Fitting burned-in text to the frame.

`WrapStyle: 2` in the ASS header means libass breaks a line only where a literal
`\N` appears, and `\pos()` overrides the style's MarginL/MarginR entirely. So
nothing in the subtitle layer was ever going to wrap a long line for us: it
renders at full width, centred on x=540, and runs off both edges.

Measured against the library as it stands, at the Hook style's 60px Arial Black:

    68 distinct hooks
    53 render wider than the 1080px canvas
    widest 1893px -- 813px past the frame, so ~40% of the line is lost off each
      side: 'Asking the chat for one word, then building a song from it'

Captions are a different story, and that measurement is why this module does not
touch how they are grouped. Over the whole 2026-07-03 transcript (24,843 words)
`group_pages()` produced 10,629 pages and **none** exceeded the safe width -- the
MAX_CHARS=14 rhythm rule holds for real speech. What a character budget cannot do
is split a single long word: DISAPPOINTMENT is the widest in that transcript at
811px, inside the frame but with only 189px of headroom. Captions therefore get a
measured backstop, not a rewrite.

Frame-edge clipping and platform coverage are different problems and are treated
differently here, per D6. Text is always fitted so no glyph leaves the canvas,
because a clipped glyph is destroyed rather than obscured. Whether the fitted box
then lands under TikTok's caption block stays a `safe_areas` warning and the
creator's call.
"""
import re
from functools import lru_cache

from PIL import ImageFont

FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Black.ttf"

# Arial Black carries no emoji glyph, so PIL returns the same 45px missing-glyph
# box for every one of them while libass falls back to Apple Color Emoji and
# draws something roughly square at the font size. Measuring the tofu would
# under-count a hook like "Watch Yanchan cook this beat up in real time [fire]"
# by ~15px per emoji. Charge a square advance instead; it is an estimate, and it
# errs toward "too wide", which is the safe direction for a fit.
_EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF⬀-⯿]"
)

# An ASS override block. Not drawn, so it has no width.
_OVERRIDE = re.compile(r"\{[^}]*\}")


@lru_cache(maxsize=8)
def _font(size: int):
    return ImageFont.truetype(FONT_PATH, size)


def text_width(text: str, size: int, scale: float = 1.0) -> int:
    """Rendered width of `text` in px at `size`, after an ASS `\\fscx` of `scale`.

    ASS scales are percentages applied to the drawn glyphs, so a 78%-scaled line
    is 78% of its natural width. The Hook style animates 78 -> 100, which means
    100 is the width that has to fit.
    """
    # `{...}` is an ASS override block, never drawn. Hooks carry `{G}` to switch
    # to amber mid-line; measuring it would charge three characters for something
    # with no width at all.
    text = _OVERRIDE.sub("", text)
    emoji = _EMOJI.findall(text)
    plain = _EMOJI.sub("", text)
    f = _font(size)
    box = f.getbbox(plain)
    width = box[2] - box[0]
    width += len(emoji) * size  # square advance per emoji, see _EMOJI above
    return round(width * scale)


def fit_lines(text: str, size: int, max_width: int, max_lines: int = 3,
              min_scale: float = 0.70) -> tuple:
    """Wrap `text` to fit `max_width`, shrinking only when wrapping is not enough.

    Returns `(lines, scale, why)`. `scale` is an ASS `\\fscx`/`\\fscy` percentage
    as a fraction; `why` names what had to be done, for the render log, and is
    empty when the text fitted as written.

    Order matters: wrap first, shrink second. Shrinking a line that would have
    fitted on two lines throws away legibility for nothing, and legibility at
    phone size is the whole point of burning the text in.
    """
    text = " ".join(text.split())
    if not text:
        return [], 1.0, ""

    if text_width(text, size) <= max_width:
        return [text], 1.0, ""

    lines = _wrap(text, size, max_width, max_lines)
    widest = max((text_width(ln, size) for ln in lines), default=0)
    if widest <= max_width:
        return lines, 1.0, f"wrapped to {len(lines)} lines"

    # Still over: either a single word is wider than the frame, or the text needs
    # more lines than max_lines allows. Shrink until it fits, and stop at
    # min_scale -- past that the text is too small to read on a phone, and
    # silently rendering something illegible is worse than rendering it clipped.
    scale = max_width / widest
    if scale < min_scale:
        scale = min_scale
        why = (f"wrapped to {len(lines)} lines and scaled to {min_scale:.0%}; "
               f"still {round(widest * scale)}px against {max_width}px")
    else:
        # Re-wrap at the smaller size: narrower glyphs fit more words per line,
        # which often buys back a line and reads better than the first wrap.
        scaled_size = max(1, round(size * scale))
        relines = _wrap(text, scaled_size, round(max_width / scale), max_lines)
        if max((text_width(ln, scaled_size) for ln in relines), default=0) \
                <= round(max_width / scale):
            lines = relines
        why = f"wrapped to {len(lines)} lines and scaled to {scale:.0%}"
    return lines, scale, why


def _greedy(words: list, size: int, max_width: int) -> list:
    """Plain greedy wrap, uncapped. A word wider than `max_width` gets its own line."""
    lines, cur = [], []
    for w in words:
        if cur and text_width(" ".join(cur + [w]), size) > max_width:
            lines.append(" ".join(cur))
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(" ".join(cur))
    return lines


def _wrap(text: str, size: int, max_width: int, max_lines: int) -> list:
    """Wrap `text` into at most `max_lines` lines, balanced rather than ragged.

    Greedy alone packs each line to the brim and leaves whatever is left over on
    the last one, which on a two-line hook reads badly: 'The pocket is the whole
    hook' came out as a 791px line and an orphaned 'hook'. Once the line count is
    known, the narrowest width that still yields that many lines spreads the
    words evenly across them -- same number of lines, no orphan.
    """
    words = text.split()
    if not words:
        return []

    lines = _greedy(words, size, max_width)
    if len(lines) > max_lines:
        # Too long for the allowance. Pack the first lines and let the last take
        # the remainder; the caller measures the result and scales it down.
        lines, cur = [], []
        for i, w in enumerate(words):
            if cur and text_width(" ".join(cur + [w]), size) > max_width:
                lines.append(" ".join(cur))
                if len(lines) == max_lines - 1:
                    lines.append(" ".join(words[i:]))
                    return lines
                cur = [w]
            else:
                cur.append(w)
        if cur:
            lines.append(" ".join(cur))
        return lines

    # Balance: the narrowest width that still fits in the same number of lines.
    n = len(lines)
    lo, hi, best = 1, max_width, lines
    while lo <= hi:
        mid = (lo + hi) // 2
        trial = _greedy(words, size, mid)
        if len(trial) <= n and max(text_width(ln, size) for ln in trial) <= mid:
            best, hi = trial, mid - 1
        else:
            lo = mid + 1
    return best


def too_wide(text: str, size: int, max_width: int) -> int:
    """px by which `text` overflows `max_width`, or 0. For the caption backstop."""
    return max(0, text_width(text, size) - max_width)


if __name__ == "__main__":
    import json
    import sys
    from pathlib import Path

    # Report the fit for every hook in the library, so the effect of a change to
    # the wrapping rules is visible without rendering anything.
    lib = Path(__file__).resolve().parent.parent.parent / "clips" / "library.json"
    size = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    max_width = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
    data = json.loads(lib.read_text())
    clips = data["clips"]
    clips = list(clips.values()) if isinstance(clips, dict) else clips
    hooks = sorted({(c.get("copy") or {}).get("hook", "") for c in clips} - {""})
    print(f"{len(hooks)} hooks at {size}px into {max_width}px\n")
    counts = {"as written": 0, "wrapped": 0, "scaled": 0}
    for h in hooks:
        lines, scale, why = fit_lines(h, size, max_width)
        key = "as written" if not why else ("scaled" if "scaled" in why else "wrapped")
        counts[key] += 1
        print(f"  {text_width(h, size):5}px -> {len(lines)} line(s) "
              f"@ {scale:.0%}  {why or 'fits as written'}")
        for ln in lines:
            print(f"        | {ln}")
    print("\n" + "  ".join(f"{k}: {v}" for k, v in counts.items()))
