#!/usr/bin/env python3
"""Where each platform covers a clip with its own UI.

Encoded as data so the system can WARN rather than decide. That distinction was
settled on 2026-08-17: the mark was placed at y=1500 to clear every platform's
overlay, and Gobbe moved it back to y=1890 where the logo used to sit. Both are
defensible — one optimises for never being covered, the other for how the clip
looks. The system's job is to make the trade-off visible.

Figures are the conservative end of each platform's published and observed safe
areas, expressed as a fraction of the canvas so they hold for any output size.
"""
PLATFORMS = {
    "tiktok": {"bottom": 0.167, "right": 0.130, "top": 0.057,
               "note": "caption block and the right-hand button rail"},
    "reels": {"bottom": 0.182, "right": 0.093, "top": 0.052,
              "note": "caption block, audio strip and action column"},
    "shorts": {"bottom": 0.120, "right": 0.093, "top": 0.047,
               "note": "title, channel row and description"},
}


def covered(width: int, height: int, platform: str) -> dict:
    """Pixel bounds of the region `platform` draws over, for this canvas."""
    p = PLATFORMS[platform]
    return {
        "bottom_from": int(height * (1 - p["bottom"])),
        "right_from": int(width * (1 - p["right"])),
        "top_to": int(height * p["top"]),
        "note": p["note"],
    }


def worst_case(width: int, height: int) -> dict:
    """The union across every platform — the region that is safe everywhere."""
    zones = [covered(width, height, k) for k in PLATFORMS]
    return {
        "bottom_from": min(z["bottom_from"] for z in zones),
        "right_from": min(z["right_from"] for z in zones),
        "top_to": max(z["top_to"] for z in zones),
    }


def check(box: tuple, width: int, height: int) -> list:
    """Which platforms will cover this element. `box` is (x, y, w, h).

    Returns a list of (platform, reason). Empty means it is clear everywhere.
    """
    x, y, w, h = box
    hits = []
    for name in PLATFORMS:
        z = covered(width, height, name)
        why = []
        if y + h > z["bottom_from"]:
            why.append(f"reaches {y + h}px, below the {z['bottom_from']}px line")
        if x + w > z["right_from"]:
            why.append(f"extends to {x + w}px, past the {z['right_from']}px rail")
        if y < z["top_to"]:
            why.append(f"starts at {y}px, inside the top {z['top_to']}px")
        if why:
            hits.append((name, "; ".join(why) + f" ({z['note']})"))
    return hits


def describe(width: int, height: int) -> str:
    w = worst_case(width, height)
    return (f"safe everywhere on a {width}x{height} canvas: "
            f"y {w['top_to']}–{w['bottom_from']}, x 0–{w['right_from']}")


if __name__ == "__main__":
    import sys
    W, H = 1080, 1920
    print(describe(W, H))
    for name in PLATFORMS:
        z = covered(W, H, name)
        print(f"  {name:8} bottom from y={z['bottom_from']}  "
              f"right from x={z['right_from']}  top to y={z['top_to']}")
    if len(sys.argv) == 5:
        box = tuple(int(v) for v in sys.argv[1:5])
        hits = check(box, W, H)
        print(f"\n{box}: " + ("clear on every platform" if not hits else ""))
        for name, why in hits:
            print(f"  {name}: {why}")
