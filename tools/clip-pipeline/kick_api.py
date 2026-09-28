#!/usr/bin/env python3
"""Ask Kick what VODs it still holds, through whichever door is open.

WHY A CHAIN AND NOT A METHOD
Kick sits behind Cloudflare and the way past it is not stable. Designing as
though one method will hold is the mistake; the chain is the design (D1). Each
rung is tried in order, the first success wins, and the method that worked is
recorded with the scan so a silent downgrade is visible.

    1. headers      stdlib urllib with a browser User-Agent. No dependency.
    2. impersonate  curl_cffi, which reproduces a real browser's TLS fingerprint.
    3. bridge       the local browser bridge on 127.0.0.1:10086, driving the
                    channel's own logged-in browser.

WHAT WAS MEASURED, 2026-09-07
The 403 this file exists to get past is a **User-Agent check, not a TLS block**.
Bare `urllib.request.urlopen(API)` returns 403; the same request carrying a
Chrome User-Agent returns 200 and the full VOD list, HLS sources included. So
rung 1 needs no dependency at all, and the browser bridge -- which `capture.sh`
treated as the only way in, and which cannot run headless -- was never actually
required. That is what unblocks unattended capture.

curl_cffi is kept as rung 2 rather than dropped, because a User-Agent string is
the weakest possible check and the day Kick starts fingerprinting TLS is the day
an unattended job needs a rung that is already installed. Verified working the
same day: `impersonate="chrome"` returns the same 200 and the same 6 VODs.

yt-dlp is deliberately NOT a rung. Its Kick extractor resolves
`kick.com/<channel>/videos` to the *live* extractor and fails with "The channel
is not currently live" -- it downloads a known VOD (which is what fetch_vod.py
uses it for) but cannot enumerate a channel. Listing it as a fallback would have
been a rung that never fires.
"""
import json
import os
import time
import urllib.request
from pathlib import Path

CHANNEL = os.environ.get("YP_KICK_CHANNEL", "yanchanproduced")
API = "https://kick.com/api/v2/channels/{channel}/videos"
BRIDGE = os.environ.get("YP_BRIDGE", "http://127.0.0.1:10086")
BRIDGE_SESSION = "yp-capture"

# A real Chrome's headers. This is the whole difference between 403 and 200.
BROWSER_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/131.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

# Read the same fields the browser rung's JavaScript reads, so all three rungs
# produce one shape and `ingest.py --import-scan` never learns which one ran.
READ_JS = ("(() => { const v = JSON.parse(document.body.innerText); "
           "return JSON.stringify(v.map(x => ({live_id: x.id, uuid: (x.video||{}).uuid, "
           "slug: x.slug, title: x.session_title, start: x.start_time, "
           "dur_ms: x.duration, views: x.views, hls: x.source}))); })()")


class ScanFailed(RuntimeError):
    """Every rung was tried and none of them answered."""


def _normalise(raw: list) -> list:
    return [{"live_id": v.get("id"),
             "uuid": (v.get("video") or {}).get("uuid"),
             "slug": v.get("slug"),
             "title": v.get("session_title"),
             "start": v.get("start_time"),
             "dur_ms": v.get("duration"),
             "views": v.get("views"),
             "hls": v.get("source")} for v in raw]


def via_headers(channel: str, timeout: float) -> list:
    req = urllib.request.Request(API.format(channel=channel), headers=BROWSER_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return _normalise(json.loads(resp.read()))


def via_impersonate(channel: str, timeout: float) -> list:
    # Imported here, not at module scope: a missing or broken curl_cffi must cost
    # this rung and nothing else. The scan still runs on rungs 1 and 3.
    from curl_cffi import requests as cffi_requests
    resp = cffi_requests.get(API.format(channel=channel),
                             impersonate="chrome", timeout=timeout)
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}")
    return _normalise(resp.json())


def _bridge_call(action: str, args: dict, timeout: float):
    body = json.dumps({"action": action, "args": args,
                       "session": BRIDGE_SESSION}).encode()
    req = urllib.request.Request(f"{BRIDGE}/command", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def via_bridge(channel: str, timeout: float) -> list:
    with urllib.request.urlopen(f"{BRIDGE}/status", timeout=5) as r:
        if not json.loads(r.read()).get("extension_connected"):
            raise RuntimeError("browser extension not connected")
    _bridge_call("navigate", {"url": API.format(channel=channel),
                              "newTab": True, "group_title": "YP capture"}, timeout)
    try:
        for _ in range(6):              # the tab needs a beat before the body is JSON
            resp = _bridge_call("evaluate", {"code": READ_JS}, timeout)
            value = (resp.get("data") or {}).get("value")
            if resp.get("ok") and value and value.startswith("["):
                return json.loads(value)
            time.sleep(2)
    finally:
        try:
            _bridge_call("close_session", {}, timeout)
        except Exception:
            pass
    raise RuntimeError("the bridge answered but never returned the VOD list")


RUNGS = (("headers", via_headers),
         ("impersonate", via_impersonate),
         ("bridge", via_bridge))


def scan(channel: str = CHANNEL, timeout: float = 25.0, log=None):
    """Return (vods, method). Raises ScanFailed only if every rung failed."""
    problems = []
    for name, rung in RUNGS:
        try:
            vods = rung(channel, timeout)
        except Exception as exc:
            problems.append(f"{name}: {type(exc).__name__}: {exc}")
            if log:
                log(f"  scan rung '{name}' did not answer ({type(exc).__name__})")
            continue
        if not vods:
            problems.append(f"{name}: answered with an empty list")
            continue
        # A record with no uuid cannot be keyed, merged or downloaded.
        usable = [v for v in vods if v.get("uuid")]
        if not usable:
            problems.append(f"{name}: {len(vods)} record(s), none with a uuid")
            continue
        return usable, name
    raise ScanFailed("no way in to Kick right now.\n  " + "\n  ".join(problems))


if __name__ == "__main__":
    import sys
    try:
        vods, method = scan(log=print)
    except ScanFailed as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
    print(f"{len(vods)} VOD(s) via {method}")
    for v in vods:
        print(f"  {v['start']}  {v['uuid']}  {v['title']}")
