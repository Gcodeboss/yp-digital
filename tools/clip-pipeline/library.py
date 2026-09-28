#!/usr/bin/env python3
"""The clip library: one cumulative record of every clip this pipeline has made.

Why this exists: `build_strategy.py` used to write ONE `clips/strategy.md` and
`rmtree` the `by-context/` folder on every run. Processing a second stream
therefore deleted the first stream's paperwork -- three streams of work were on
disk but only the last stream's two clips were visible anywhere.

So the store of record moves here, to `clips/library.json`, and it is MERGED on
every rebuild rather than overwritten. The pipeline owns the mechanical fields
(path, timing, layout, tag, score, qa). A human -- or Claude writing the review
pack -- owns the copy and the review state:

    copy.hook / copy.hook_alt / copy.caption      written per clip, not per tag
    status    new | approved | rejected | posted
    scheduled free text slot

Those two blocks are preserved across rebuilds. Re-running the pipeline on a
stream refreshes the mechanics and leaves approved copy alone, which is what
makes an approval workflow possible at all.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
LIBRARY = PROJECT_ROOT / "clips" / "library.json"

VERSION = 2
# Blocks a human owns. An automatic stage may FILL one that is absent; it may never
# overwrite one that is present. That rule is what makes "fix it and re-render" safe,
# and it is the reason approvals and hand-written hooks survive a pipeline re-run.
HUMAN_FIELDS = ("copy", "status", "scheduled", "notes", "creator", "history")

# Fields inside `creator` that override the mechanically-measured value of the
# same name on the clip record.
CREATOR_OVERRIDES = ("start", "end", "context_tag", "framing", "hook", "layout",
                     "output_mode", "mirror")
HISTORY_LIMIT = 200

# --- Paths that survive being moved --------------------------------------------
#
# Batch records used to store `work_dir`, `source` and `calibration` as absolute
# paths. That made the store of record machine-bound: `library.json` ships, so a
# fresh install inherited eight batches pointing at a home directory that does not
# exist on the machine reading them. It was already broken *here* — the two files
# under `streams/prepare/` still name `/Users/gbase/yanchan/...`, a path that
# stopped existing when the repo moved under `work/personal/`.
#
# So: store relative to the repo, resolve on read. `archive.py` has always done
# this for stream paths; this is the same rule applied to the batch records.
_ANCHORS = ("streams/", "clips/", "transcripts/", "tools/clip-pipeline/")


def relative(p) -> str:
    """Store a path relative to the repo when it is inside it.

    A path genuinely outside the repo — a VOD on an external drive, allowed via
    YP_MEDIA_DIRS — stays absolute, because there is nothing to be relative to.
    """
    p = Path(p)
    try:
        return str(p.resolve().relative_to(PROJECT_ROOT))
    except ValueError:
        return str(p)


def resolve_path(value):
    """Read a stored path, whatever generation wrote it.

    Three cases, in order: a relative path (what we write now); an absolute path
    that still exists (a legitimate external file, or a legacy record on the
    machine that wrote it); and an absolute path that does not exist, which is a
    record from somewhere else — re-rooted here by its first in-repo anchor so an
    old library still works on arrival rather than silently resolving to nothing.
    """
    if not value:
        return None
    p = Path(value)
    if not p.is_absolute():
        return PROJECT_ROOT / p
    if p.exists():
        return p
    s = str(p).replace("\\", "/")
    for a in _ANCHORS:
        i = s.rfind("/" + a)
        if i != -1:
            return PROJECT_ROOT / s[i + 1:]
    return p


PATH_FIELDS = ("work_dir", "source", "calibration")


def migrate_paths(data: dict) -> int:
    """Rewrite absolute batch paths as relative. Idempotent; returns the count."""
    changed = 0
    for batch in (data.get("batches") or {}).values():
        for field in PATH_FIELDS:
            value = batch.get(field)
            if not value or not Path(value).is_absolute():
                continue
            batch[field] = relative(resolve_path(value))
            changed += 1
    return changed


def load(path: Path = LIBRARY) -> dict:
    if not path.exists():
        return {"version": VERSION, "clips": {}}
    data = json.loads(path.read_text())
    data.setdefault("clips", {})
    return data


def save(data: dict, path: Path = LIBRARY) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data["version"] = VERSION
    path.write_text(json.dumps(data, indent=2, sort_keys=False) + "\n")


def merge_stream(data: dict, date: str, source_name: str, entries: list) -> dict:
    """Refresh one stream's mechanical fields; never touch copy or status.

    Clips that no longer exist for this date are dropped, so deleting a clip file
    and re-running actually removes it instead of leaving a ghost in the doc.

    A clip is keyed by its path, but the path is DERIVED -- compose names the file
    `<HHMMSS>_<context_tag>.mp4`. So correcting a tag from `beat` to `singing`
    renames the file, and keying on path alone made that a different clip: the
    approval and the hand-written hook stayed attached to a filename nothing
    would render again, the stale pre-retag MP4 stayed on disk marked rendered,
    and `build_export_pack` shipped that older file. What actually identifies a
    clip is when it starts, so a renamed clip inherits from its old record by
    start time before the old key is dropped.
    """
    keep = {e["path"] for e in entries}

    # Same date, same start = the same clip, whatever it is now called.
    by_start = {
        round(c["start"], 1): c
        for p, c in data["clips"].items()
        if c.get("date") == date and p not in keep and isinstance(c.get("start"), (int, float))
    }

    for path in [p for p, c in data["clips"].items()
                 if c.get("date") == date and p not in keep]:
        del data["clips"][path]

    for e in entries:
        existing = data["clips"].get(e["path"], {})
        if not existing and isinstance(e.get("start"), (int, float)):
            existing = by_start.get(round(e["start"], 1), {})
        merged = {**e, "date": date, "source": source_name}
        for field in HUMAN_FIELDS:
            if field in existing:
                merged[field] = existing[field]
        merged.setdefault("copy", {})
        merged.setdefault("status", "new")
        merged.setdefault("scheduled", "")
        data["clips"][e["path"]] = merged
    return data


def resolve(clip: dict) -> dict:
    """The clip as it should be rendered: measured values with creator edits on top.

    Every consumer that renders, scores or documents a clip reads it through here,
    so there is one place where "the human said otherwise" is applied.
    """
    out = dict(clip)
    for field, value in (clip.get("creator") or {}).items():
        if field in CREATOR_OVERRIDES and value is not None:
            out[field] = value
    if "start" in out and "end" in out:
        out["duration"] = out["end"] - out["start"]
    return out


def set_creator(data: dict, path: str, field: str, value, note: str = "") -> dict:
    """Record a creator decision, with enough history to undo it."""
    if field not in CREATOR_OVERRIDES:
        raise ValueError(f"not a creator-settable field: {field!r} "
                         f"(one of {', '.join(CREATOR_OVERRIDES)})")
    clip = data["clips"][path]
    creator = dict(clip.get("creator") or {})
    before = creator.get(field)
    creator[field] = value
    clip["creator"] = creator

    history = list(clip.get("history") or [])
    history.append({"field": field, "from": before, "to": value, "note": note})
    clip["history"] = history[-HISTORY_LIMIT:]
    return clip


def undo(data: dict, path: str) -> dict:
    """Step one creator edit back. Undo needs the previous VALUE, not just the
    current one, which is why history stores both ends of every change."""
    clip = data["clips"][path]
    history = list(clip.get("history") or [])
    if not history:
        return clip
    last = history.pop()
    creator = dict(clip.get("creator") or {})
    if last["from"] is None:
        creator.pop(last["field"], None)
    else:
        creator[last["field"]] = last["from"]
    clip["creator"] = creator
    clip["history"] = history
    return clip


def is_creator_set(clip: dict, field: str) -> bool:
    return (clip.get("creator") or {}).get(field) is not None


def clips(data: dict, date: str = None) -> list:
    """All clips, newest stream first, chronological within a stream."""
    out = [resolve(dict(c, path=p)) for p, c in data["clips"].items()
           if date is None or c.get("date") == date]
    out.sort(key=lambda c: (c.get("date", ""), c.get("start", 0)))
    return out


def record_settings(data: dict, date: str, settings: dict) -> None:
    """The selection settings a batch was produced with.

    Kept so a surprising batch can be explained rather than argued about: the
    thresholds that produced it are as much a part of the record as the clips.

    MERGED, not replaced. A batch is written by more than one stage and no stage
    knows the whole record: preparation stamps `work_dir`, `source`,
    `calibration` and `stream_duration`; selection stamps the guardrails it ran
    with. This replaced the batch outright, so selecting a stream deleted what
    preparation had written -- and because `work_dir` is the entire definition of
    "prepared", the stream silently reverted to unprepared and the timeline lost
    its music map, calibration and video. `prepare_stream.py` already worked
    around it by reading the batch back and merging by hand; nothing else did.

    Same contract as `merge_stream` above, and for the same reason: a partial
    write from one stage must never erase another stage's work.
    """
    batch = data.setdefault("batches", {}).setdefault(date, {})
    batch.update(settings)


def settings_for(data: dict, date: str) -> dict:
    return (data.get("batches") or {}).get(date, {})


def hook_for(clip: dict, fallback: str) -> str:
    """Per-clip copy wins over the per-tag default. That is the whole point."""
    return (clip.get("copy") or {}).get("hook") or fallback


def alt_for(clip: dict, fallback: str) -> str:
    return (clip.get("copy") or {}).get("hook_alt") or fallback
