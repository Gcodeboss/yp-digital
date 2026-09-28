#!/usr/bin/env python3
"""The stream archive: one record of every stream we know about, captured or not.

Kick deletes a non-verified channel's VODs after about 30 days. The three streams
that were on disk before this existed survived only because someone downloaded
them by hand; the first real scan (2026-08-18) found seven more on Kick that
nobody had, the oldest three days from deletion. This file is what stops that
happening again.

Same contract as `library.py`, for the same reason: MERGE, never overwrite, and
publish paths rather than conventions. A consumer that rebuilds a path from a
naming rule breaks silently when the rule changes -- that is exactly how the
dashboard's clip previews came to 404.

Keyed on the VOD's uuid, which Kick assigns and which survives a re-scan.

Status of a stream:
    kick_only      Kick has it, we do not. Has a deletion clock.
    archived       On disk, verified complete. Safe forever.
    unrecoverable  Kick no longer serves it and we never captured it. Gone.
"""
import json
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
ARCHIVE = PROJECT_ROOT / "streams" / "archive.json"

VERSION = 1
RETENTION_DAYS = 30          # Kick, non-verified channel
STALE_AFTER_DAYS = 3         # a scan older than this cannot be trusted to say "0"
# Fields the scan owns; everything else on a record is ours and survives a re-scan.
SCAN_FIELDS = ("live_id", "uuid", "slug", "title", "stream_date", "duration_s",
               "source_hls", "views")


def load(path: Path = ARCHIVE) -> dict:
    if not path.exists():
        return {"version": VERSION, "streams": {}}
    data = json.loads(path.read_text())
    data.setdefault("streams", {})
    return data


def save(data: dict, path: Path = ARCHIVE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data["version"] = VERSION
    path.write_text(json.dumps(data, indent=2) + "\n")


def merge_scan(data: dict, scanned: list, scanned_at: str) -> dict:
    """Fold a channel scan into the archive.

    A stream Kick no longer lists is NOT deleted from the archive. If we hold it,
    it stays `archived`; if we never captured it, it becomes `unrecoverable` and
    is reported. Dropping it would quietly turn a loss into an absence.
    """
    seen = set()
    for v in scanned:
        uuid = v["uuid"]
        seen.add(uuid)
        rec = data["streams"].get(uuid, {})
        rec.update({k: v.get(k) for k in SCAN_FIELDS})
        rec["last_seen_on_kick"] = scanned_at
        rec.setdefault("status", "kick_only")
        rec.setdefault("path", None)
        data["streams"][uuid] = rec

    for uuid, rec in data["streams"].items():
        # "We still hold a file for this" is the question, and `partial` answers
        # yes -- 2026-08-25 is 2.67 GB of real footage that Kick's own manifest
        # served short. Filtering on "archived" alone would mark it UNRECOVERABLE
        # the first daily run after Kick drops it from the listing, which is 18
        # days away and would have happened while nobody was watching. Third time
        # this exact filter has been wrong; `archived()` below is the same rule.
        if uuid in seen or rec.get("status") in ("archived", "partial"):
            continue
        if rec.get("status") != "unrecoverable":
            rec["status"] = "unrecoverable"
            rec["lost_noticed"] = scanned_at
    return data


def days_left(rec: dict, today: date = None) -> int:
    """Days until Kick deletes it. Negative means it is past the window already."""
    today = today or date.today()
    d = datetime.strptime(rec["stream_date"][:10], "%Y-%m-%d").date()
    return RETENTION_DAYS - (today - d).days


def at_risk(data: dict, today: date = None) -> list:
    """Streams Kick still holds that we do not, most urgent first."""
    out = [dict(r, uuid=u) for u, r in data["streams"].items()
           if r.get("status") == "kick_only"]
    out.sort(key=lambda r: days_left(r, today))
    return out


def archived(data: dict) -> list:
    """Every stream with a usable file on disk — including a partial capture.

    `partial` means the capture is real and short (2026-08-25 came down at 70% of
    its advertised length because Kick's own HLS manifest is short). The whole
    point of that state is that the footage stays clippable while the record stays
    honest, so it belongs here: every caller of this function asks "which streams
    do I have a file for" -- `prepare_stream.source_for()`, `make_proxy.sources()`,
    `ingest verify` and `ingest status`. Excluding it silently made a partial
    stream unpreparable and unplayable, which is the opposite of the intent.
    """
    out = [dict(r, uuid=u) for u, r in data["streams"].items()
           if r.get("status") in ("archived", "partial")]
    out.sort(key=lambda r: r.get("stream_date", ""), reverse=True)
    return out


def unrecoverable(data: dict) -> list:
    return [dict(r, uuid=u) for u, r in data["streams"].items()
            if r.get("status") == "unrecoverable"]


# --- when we last managed to ask Kick anything -----------------------------
# The archive knows what it holds. Until now it did not know how long ago it
# last found out, which is the difference between "nothing is at risk" and
# "nothing was at risk three weeks ago".

def record_scan(data: dict, method: str, scanned_at: str, count: int = None) -> dict:
    """Remember that a scan succeeded, and which rung of the chain answered.

    The method matters as much as the time. A silent downgrade from `headers` to
    `bridge` means the unattended path has stopped working and only a person at
    the keyboard is still getting scans through -- which looks identical to
    everything being fine, right up until nobody is at the keyboard.
    """
    data["last_successful_scan"] = {"at": scanned_at, "method": method,
                                    "vods_seen": count}
    return data


def scan_age_days(data: dict, now: datetime = None):
    """Days since the last successful scan, or None if there has never been one."""
    last = (data.get("last_successful_scan") or {}).get("at")
    if not last:
        return None
    try:
        seen = datetime.fromisoformat(last.replace("Z", "+00:00"))
    except ValueError:
        return None
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return (now - seen).total_seconds() / 86400.0


def scan_state(data: dict, today: date = None, now: datetime = None) -> dict:
    """fresh / stale / at_risk, and the rule that is the whole point of it.

    `AT RISK 0` printed from a scan weeks old is worse than printing nothing: it
    is a confident all-clear over data that cannot support one. That line was on
    screen on 2026-09-06, from a 19-day-old scan, while three streams sat
    uncaptured on Kick -- two of them inside a fortnight of deletion.

    So staleness outranks the count. When the scan is too old, `at_risk` is None
    -- unknown -- and never 0. Every caller renders None as "unknown", not "none".
    """
    age = scan_age_days(data, now)
    last = data.get("last_successful_scan") or {}
    base = {"age_days": None if age is None else round(age, 2),
            "last_scan": last.get("at"), "method": last.get("method"),
            "stale_after_days": STALE_AFTER_DAYS}

    if age is None or age >= STALE_AFTER_DAYS:
        how_old = ("Kick has never been scanned on this machine." if age is None
                   else f"The last Kick scan is {age:.0f} days old.")
        return {**base, "state": "stale", "at_risk": None, "soonest_days_left": None,
                "message": (f"{how_old} What is at risk right now is unknown "
                            "until it scans again.")}

    risky = at_risk(data, today)
    if risky:
        soonest = days_left(risky[0], today)
        return {**base, "state": "at_risk", "at_risk": len(risky),
                "soonest_days_left": soonest,
                "message": (f"{len(risky)} stream(s) on Kick are not captured. "
                            f"The most urgent has {soonest} day(s) left.")}

    return {**base, "state": "fresh", "at_risk": 0, "soonest_days_left": None,
            "message": f"Scanned {age * 24:.0f}h ago via {last.get('method')}. Nothing at risk."}


def mark_archived(data: dict, uuid: str, path: Path, size: int,
                  resolution: str, duration_s: float, method: str,
                  captured_at: str, fps: float = None) -> dict:
    """Record a completed capture.

    `fps` is recorded because it changed under us and nothing noticed: the
    download format is pinned `[height<=720][fps<=30]` but ends in `/best`, which
    drops both constraints, and the captures from 2026-08-09 on are 720p60 while
    everything before them is 720p30. The resolution held, so no check fired.
    Optional, so an older record simply has no fps rather than a wrong one.
    """
    rec = data["streams"].setdefault(uuid, {})
    rec.update({
        "status": "archived",
        "path": str(path.relative_to(PROJECT_ROOT)) if path.is_absolute() else str(path),
        "bytes": size,
        "resolution": resolution,
        "measured_duration_s": round(duration_s, 1),
        "fetch_method": method,
        "captured_at": captured_at,
    })
    if fps is not None:
        rec["fps"] = round(fps, 3)
    return rec


def register_local(data: dict, uuid: str, path: Path, **fields) -> dict:
    """Record a stream that was captured before this archive existed."""
    rec = data["streams"].setdefault(uuid, {})
    rec.setdefault("status", "archived")
    rec.setdefault("path", str(path))
    rec.update({k: v for k, v in fields.items() if v is not None})
    return rec
