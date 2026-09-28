#!/usr/bin/env python3
"""Sync finished clips to Google Drive: Yanchan Clips Library/<stream>/<theme>/clip.mp4

Idempotent: folder IDs are cached in tools/clip-pipeline/work/drive_folders.json.
Safe to re-run after new batches finish — only new folders/files are created.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/gbase/work/personal/yanchan")
LIB = json.loads((ROOT / "clips/library.json").read_text())
CACHE_PATH = ROOT / "tools/clip-pipeline/work/drive_folders.json"
DRIVE_ROOT_NAME = "Yanchan Clips Library"

STREAM_TITLES = {
    "2026-06-26": "Just Chatting (solo)",
    "2026-07-03": "Live Session w Tresor",
    "2026-07-08": "Live Session w Kiki Rowe",
    "2026-07-22": "Live Session w Muthoni I",
    "2026-07-29": "Live Session w Muthoni II",
    "2026-07-31": "Playing Ball (IRL)",
    "2026-08-09": "Tamil's Day Live Performance",
    "2026-08-12": "Live Session w Rochester",
}


def gws(*args):
    r = subprocess.run(["gws", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"gws {' '.join(args)} failed:\n{r.stdout}\n{r.stderr}")
    return json.loads(r.stdout)


def find_folder(name, parent=None):
    q = f'name = "{name}" and mimeType = "application/vnd.google-apps.folder" and trashed = false'
    if parent:
        q += f" and '{parent}' in parents"
    res = gws("drive", "files", "list", "--params", json.dumps({"q": q, "fields": "files(id,name)"}))
    files = res.get("files", [])
    return files[0]["id"] if files else None


def mkdir(name, parent=None):
    key = f"{parent or 'root'}/{name}"
    cache = load_cache()
    if key in cache:
        return cache[key]
    existing = find_folder(name, parent)
    if existing:
        cache[key] = existing
        save_cache(cache)
        return existing
    body = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent:
        body["parents"] = [parent]
    res = gws("drive", "files", "create", "--params", '{"fields": "id,name"}', "--json", json.dumps(body))
    fid = res["id"]
    cache[key] = fid
    save_cache(cache)
    print(f"  created folder: {name} ({fid})")
    return fid


def load_cache():
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text())
    return {}


def save_cache(cache):
    CACHE_PATH.write_text(json.dumps(cache, indent=2))


def main():
    only_dates = set(sys.argv[1:])
    root_id = mkdir(DRIVE_ROOT_NAME)
    print(f"Drive root: {DRIVE_ROOT_NAME} ({root_id})")

    # group clips by (date, tag)
    groups = {}
    for path, clip in sorted(LIB["clips"].items()):
        date = clip.get("date", "unknown")
        if only_dates and date not in only_dates:
            continue
        tag = clip.get("context_tag", "misc")
        groups.setdefault(date, {}).setdefault(tag, []).append((path, clip))

    uploaded, skipped, failed = 0, 0, 0
    for date in sorted(groups):
        title = STREAM_TITLES.get(date, date)
        stream_folder = mkdir(f"{date} — {title}", root_id)
        for tag in sorted(groups[date]):
            theme_folder = mkdir(tag.capitalize(), stream_folder)
            for path, clip in groups[date][tag]:
                local = ROOT / clip["path"]
                if not local.exists():
                    print(f"  MISSING local file, skipped: {clip['path']}")
                    failed += 1
                    continue
                # skip if already uploaded (same name in folder)
                q = (f'name = "{local.name}" and \'{theme_folder}\' in parents and trashed = false')
                res = gws("drive", "files", "list", "--params", json.dumps({"q": q, "fields": "files(id)"}))
                if res.get("files"):
                    skipped += 1
                    continue
                r = subprocess.run(
                    ["gws", "drive", "+upload", str(local), "--parent", theme_folder],
                    capture_output=True, text=True)
                if r.returncode != 0:
                    print(f"  UPLOAD FAIL {local.name}: {r.stderr[-200:]}")
                    failed += 1
                else:
                    uploaded += 1
                    print(f"  uploaded {date}/{tag}/{local.name}")

    print(f"\nDONE uploaded={uploaded} already_present={skipped} failed={failed}")


if __name__ == "__main__":
    main()
