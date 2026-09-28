#!/usr/bin/env python3
"""Selection guardrails: the knobs that decide what gets clipped.

These used to be argparse defaults and module constants, which meant changing how
a batch is selected required editing code and left no record of what produced it.
A surprising batch was therefore unexplainable after the fact.

Now they are settings with a file behind them, defaults can be overridden per
stream, and `library.record_settings()` stamps the resolved values onto the batch.

    clips/selection-settings.json
    {
      "defaults": {"count": 10, ...},
      "streams": {"2026-07-03": {"spacing": 180}}
    }
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
SETTINGS = PROJECT_ROOT / "clips" / "selection-settings.json"

DEFAULTS = {
    "count": 10,            # the content engine's target is 8-15 per capture
    "target_length": 30.0,  # seconds
    "min_duration": 20.0,
    "spacing": 240.0,       # keep a batch from being all one song
    "kind": "any",          # any | singing | instrumental
    "sung_weight": 0.30,    # share of the ranking vocal presence is worth
    "skip_head": 120.0,     # stream intro bumper music
    "skip_tail": 90.0,
    "layout": "any",        # any | split
}

# Human-readable reasons a batch can come up short, so the shortfall is explained
# rather than just observed.
CONSTRAINTS = {
    "spacing": "minimum spacing between picks",
    "supply": "eligible music segments in the stream",
    "layout": "candidates that resolve to the requested layout",
    "duration": "segments long enough to fill a clip",
}


def load(path: Path = SETTINGS) -> dict:
    if not path.exists():
        return {"defaults": dict(DEFAULTS), "streams": {}}
    data = json.loads(path.read_text())
    data.setdefault("defaults", {})
    data.setdefault("streams", {})
    return data


def save(data: dict, path: Path = SETTINGS) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def resolve(date: str = None, overrides: dict = None, path: Path = SETTINGS) -> dict:
    """Defaults, then the stream's own settings, then anything passed explicitly."""
    data = load(path)
    out = dict(DEFAULTS)
    out.update(data.get("defaults") or {})
    if date:
        out.update((data.get("streams") or {}).get(date) or {})
    out.update({k: v for k, v in (overrides or {}).items() if v is not None})
    return out


def set_for_stream(date: str, values: dict, path: Path = SETTINGS) -> dict:
    data = load(path)
    data.setdefault("streams", {}).setdefault(date, {}).update(values)
    save(data, path)
    return data
