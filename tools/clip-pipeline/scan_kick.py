#!/usr/bin/env python3
"""Ask Kick what VODs it still holds, and write kick_scan.json.

This is the CLI around `kick_api.scan()`. The rungs, and what was measured about
each of them, live there. What this adds is the two things a scheduled run needs:
the scan file `ingest.py --import-scan` reads, and a record in the archive of
*when* the scan last succeeded and *which* rung answered.

    scan_kick.py            scan, write kick_scan.json, stamp the archive
    scan_kick.py --state    print the fresh/stale/at-risk state and stop

The output shape is unchanged, so `ingest.py --import-scan kick_scan.json` never
learns which door the scan came through.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import archive
import kick_api

OUT = Path(__file__).resolve().parent / "kick_scan.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", action="store_true",
                    help="report scan freshness without scanning")
    ap.add_argument("--channel", default=kick_api.CHANNEL)
    args = ap.parse_args()

    if args.state:
        print(json.dumps(archive.scan_state(archive.load()), indent=2))
        return 0

    try:
        vods, method = kick_api.scan(args.channel, log=print)
    except kick_api.ScanFailed as exc:
        # Every rung failed. Say so as a fact about the scan, and let the caller
        # decide what to do -- capture.sh back-fills from the last scan rather
        # than treating this as the end of the run.
        print(f"could not scan Kick: {exc}", file=sys.stderr)
        return 1

    OUT.write_text(json.dumps(vods, indent=2))

    # Stamp the archive. Without this the dashboard can say what is at risk but
    # not whether that answer is current, which is how "AT RISK 0" came to be
    # printed from a 19-day-old scan.
    data = archive.load()
    archive.record_scan(data, method,
                        datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        len(vods))
    archive.save(data)

    missing = [v for v in vods if not v.get("hls")]
    print(f"scanned {len(vods)} VOD(s) via {method} -> {OUT.name}"
          + (f" ({len(missing)} without an HLS source)" if missing else ""))
    print(archive.scan_state(data)["message"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
