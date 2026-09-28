#!/usr/bin/env python3
"""Write per-clip post copy into clips/library.json.

The pipeline can only ever produce copy that is generic to a tag: `tags.py` holds
two hook lines per tag, so every "beat" clip in a batch shipped the identical
hook. Real copy has to come from what is actually IN that clip, which means a
human or Claude reading the transcript excerpt and writing to the clip.

This is the write path for that. It never touches the mechanical fields, and
build_strategy.py preserves whatever it writes across pipeline re-runs.

    set_copy.py --path clips/2026-07-03/011637_singing.mp4 \
                --hook "..." --alt "..." --caption "..."

    set_copy.py --stdin < copy.json      # {"clips/...": {"hook": "...", ...}}
"""
import argparse
import json
import sys

import library


def apply(data, path, fields):
    clip = data["clips"].get(path)
    if clip is None:
        raise SystemExit(f"Not in the library: {path}\n"
                         f"Known: {chr(10).join(sorted(data['clips'])[:10])}")
    copy = dict(clip.get("copy") or {})
    copy.update({k: v for k, v in fields.items() if v})
    clip["copy"] = copy
    return clip


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", help="clip path exactly as it appears in the library")
    ap.add_argument("--hook")
    ap.add_argument("--alt", dest="hook_alt")
    ap.add_argument("--caption")
    ap.add_argument("--status", choices=["new", "approved", "needs_edit",
                                         "scheduled", "posted", "rejected"])
    ap.add_argument("--stdin", action="store_true",
                    help="read {path: {hook, hook_alt, caption}} from stdin")
    args = ap.parse_args()

    data = library.load()
    touched = 0
    if args.stdin:
        for path, fields in json.load(sys.stdin).items():
            apply(data, path, fields)
            touched += 1
    else:
        if not args.path:
            raise SystemExit("--path or --stdin required")
        clip = apply(data, args.path, {"hook": args.hook, "hook_alt": args.hook_alt,
                                       "caption": args.caption})
        if args.status:
            clip["status"] = args.status
        touched = 1
    library.save(data)
    print(f"Updated copy on {touched} clip(s) -> {library.LIBRARY}")


if __name__ == "__main__":
    main()
