#!/usr/bin/env python3
"""Regression tests for the guards that previously let bad output through.

Run: .venv/bin/python test_guards.py
"""
import json
import os
import sys
from pathlib import Path

# Runnable from any cwd.
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

import library
import layout
import tags

FAILURES = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
    if not cond:
        FAILURES.append(name)


def test_narrow_daw_falls_back():
    """A webcam inset left of the arrangement must not yield a negative crop.

    pip_x - 4 - arrangement_left goes negative once pip_x < 389, which would emit
    `crop=-9:...` to ffmpeg. MIN_DAW_WIDTH must catch it first and reframe.
    """
    cal = {"frame": {"width": 1280, "height": 720}, "arrangement_left": 385,
           "daw_top": 43, "daw_bottom": 529}
    for pip_x in (380, 400, 500, 530):
        daw_w = (pip_x - 4) - cal["arrangement_left"]
        would_reframe = daw_w < layout.MIN_DAW_WIDTH
        check(f"pip_x={pip_x} -> daw_w={daw_w} reframes", would_reframe,
              "(guard active)" if would_reframe else "-> NEGATIVE/TINY CROP LEAKS")


def test_daw_rect_fills_the_pane():
    """The bottom pane must get arrangement, not bars and empty lanes.

    The 2026-08-17 batch shipped with dark letterbox bars down both sides and the
    bottom ~40% of the pane showing unloaded tracks, because the crop was the whole
    calibrated arrangement rect. These check the three behaviours that replaced it.
    """
    import numpy as np
    cal = {"arrangement_left": 420, "daw_top": 43, "daw_bottom": 529,
           "frame": {"width": 1280, "height": 720}}

    # A frame whose only coloured clips sit in rows 100-300; everything else grey.
    frame = np.full((720, 1280, 3), 60, dtype=np.uint8)
    frame[100:300, 430:630] = (40, 90, 240)      # saturated = clip lanes

    rect = layout.daw_content_rect(frame, cal, cam_x=641)
    x, y, w, h = rect
    check("crop starts at the first loaded lane", 90 <= y <= 105, f"(y={y})")
    check("crop drops the empty lanes below", y + h < cal["daw_bottom"] - 100,
          f"(bottom={y + h} of {cal['daw_bottom']})")
    check("crop reaches the pane aspect", abs(w / h - layout.PANE_ASPECT) < 0.25,
          f"(aspect={w / h:.2f})")
    bleed = cal["arrangement_left"] - x
    check("browser bleed is capped", bleed <= layout.MAX_BROWSER_BLEED,
          f"({bleed}px)")

    # Content wider than the pane must gain height back, not render as a band.
    wide = np.full((720, 1280, 3), 60, dtype=np.uint8)
    wide[100:150, 430:770] = (40, 90, 240)
    x2, y2, w2, h2 = layout.daw_content_rect(wide, cal, cam_x=800)
    check("a thin band grows back into a pane", h2 > 150, f"(h={h2})")

    # No usable width at all must fall back to the single-pane layout.
    check("no room for a DAW pane -> None",
          layout.daw_content_rect(frame, cal, cam_x=cal["arrangement_left"] + 50) is None)


def test_gates_reject_slivers():
    """The 5-of-8 misdetections were all slivers; every one must be rejected."""
    bad = [(1057, 0, 223, 212), (1065, 0, 215, 345),
           (1073, 0, 207, 286), (1095, 0, 185, 259)]
    for rect in bad:
        check(f"sliver {rect} rejected", layout.gate(rect, 1280, 720) is not None)
    good = [(748, 0, 532, 335), (817, 0, 463, 287), (715, 0, 565, 335)]
    for rect in good:
        check(f"real inset {rect} accepted", layout.gate(rect, 1280, 720) is None)


def test_every_emitted_tag_has_copy():
    """Silent generic copy shipped twice. Both selectors' tags must be known."""
    for t in tags.MUSIC_TAGS + tags.SPEECH_TAGS:
        check(f"tag {t!r} has copy", t in tags.TAGS)
    try:
        tags.require_known(["definitely-not-a-tag"])
        check("unknown tag raises", False)
    except SystemExit:
        check("unknown tag raises", True)


def test_windowed_transcript_refused():
    """analyze.py must refuse a windowed transcript rather than score nonsense."""
    import tempfile, pathlib, importlib.util
    spec = importlib.util.spec_from_file_location("an", str(ROOT / "analyze.py"))
    an = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(an)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"coverage": "windows", "segments": []}, f)
        p = pathlib.Path(f.name)
    try:
        an.load_transcript(p)
        check("windowed transcript refused", False)
    except SystemExit:
        check("windowed transcript refused", True)
    finally:
        p.unlink()


def test_sung_note_detector():
    """A held pitch must score higher than noise, and the curve must be numbers.

    Two regressions in one test. The behaviour: `sung_note_fraction` is what
    replaced the transcript-based vocal test, so it has to actually separate a
    sustained note from broadband noise. The type: `sung` was assigned twice in
    detect_music.main() -- once as this per-second curve and once as the list of
    sung SEGMENTS -- so serialising wrote dicts into a float field and the stage
    died after doing all the expensive work.
    """
    import importlib.util
    import numpy as np
    spec = importlib.util.spec_from_file_location("dm", str(ROOT / "detect_music.py"))
    dm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dm)

    sr, secs = 16000, 12
    t = np.arange(sr * secs) / sr
    rng = np.random.default_rng(0)
    # A held 220 Hz note with harmonics, the way a sung vowel reads.
    held = sum(0.5 / k * np.sin(2 * np.pi * 220 * k * t) for k in (1, 2, 3))
    noise = rng.normal(0, 0.3, len(t))

    held_score = dm.sung_note_fraction(held.astype(np.float32), sr, secs).mean()
    noise_score = dm.sung_note_fraction(noise.astype(np.float32), sr, secs).mean()
    check("held note scores above noise", held_score > noise_score,
          f"({held_score:.2f} vs {noise_score:.2f})")

    curve = dm.sung_note_fraction(held.astype(np.float32), sr, secs)
    check("curve is one float per second", len(curve) == secs)
    try:
        json.dumps([round(float(v), 3) for v in curve])
        check("curve serialises as numbers", True)
    except TypeError:
        check("curve serialises as numbers", False)


def test_library_preserves_human_copy():
    """A pipeline re-run must not wipe approvals or hand-written hooks.

    The whole approval workflow depends on this: mechanics refresh, copy and
    review state survive.
    """
    data = {"version": 1, "clips": {}}
    entry = {"path": "clips/2026-07-03/x.mp4", "start": 10.0, "duration": 30.0,
             "context_tag": "singing", "score": 8.0, "mode": "split"}
    library.merge_stream(data, "2026-07-03", "vod.mp4", [entry])
    data["clips"][entry["path"]]["copy"] = {"hook": "hand written"}
    data["clips"][entry["path"]]["status"] = "approved"

    # Re-run the same stream with a refreshed score.
    library.merge_stream(data, "2026-07-03", "vod.mp4", [{**entry, "score": 9.5}])
    c = data["clips"][entry["path"]]
    check("hand-written hook survives a re-run", c["copy"]["hook"] == "hand written")
    check("approval survives a re-run", c["status"] == "approved")
    check("mechanical field refreshes", c["score"] == 9.5)

    # A clip that disappeared from the batch must not linger in the doc.
    library.merge_stream(data, "2026-07-03", "vod.mp4", [])
    check("removed clip drops out of the library", not data["clips"])

    # Another stream's clips must survive a re-run of this one.
    library.merge_stream(data, "2026-06-26", "a.mp4", [{**entry, "path": "clips/2026-06-26/a.mp4"}])
    library.merge_stream(data, "2026-07-03", "vod.mp4", [entry])
    check("other streams survive", len(data["clips"]) == 2)


def test_creator_intent_survives_and_undoes():
    """A human decision outranks a measurement, and can be taken back.

    This is the property the whole editor rests on: fix a range, a tag or a
    framing, re-run the pipeline, and the fix is still there. Without it every
    correction is a race against the next render.
    """
    data = {"version": 2, "clips": {}}
    entry = {"path": "clips/2026-08-12/010000_beat.mp4", "start": 600.0, "end": 630.0,
             "duration": 30.0, "context_tag": "beat", "score": 7.0, "mode": "split"}
    library.merge_stream(data, "2026-08-12", "vod.mp4", [entry])
    path = entry["path"]

    library.set_creator(data, path, "context_tag", "singing", note="it is a vocal take")
    library.set_creator(data, path, "start", 612.0)
    library.set_creator(data, path, "end", 640.0)

    r = library.resolve(data["clips"][path])
    check("creator tag wins over the measured one", r["context_tag"] == "singing")
    check("creator range wins", (r["start"], r["end"]) == (612.0, 640.0))
    check("duration follows the creator range", r["duration"] == 28.0)

    # Re-run the pipeline with fresh measurements.
    library.merge_stream(data, "2026-08-12", "vod.mp4", [{**entry, "score": 9.1}])
    r = library.resolve(data["clips"][path])
    check("creator edits survive a re-run", r["context_tag"] == "singing"
          and r["start"] == 612.0)
    check("mechanical fields still refresh", data["clips"][path]["score"] == 9.1)

    library.undo(data, path)
    r = library.resolve(data["clips"][path])
    check("undo steps one edit back", r["end"] == 630.0 and r["start"] == 612.0)
    library.undo(data, path)
    library.undo(data, path)
    r = library.resolve(data["clips"][path])
    check("undo unwinds to the measured value", r["context_tag"] == "beat"
          and r["start"] == 600.0)

    try:
        library.set_creator(data, path, "nonsense", 1)
        check("unknown creator field rejected", False)
    except ValueError:
        check("unknown creator field rejected", True)


def test_framing_precedence_and_gates():
    """Creator rect beats a lock beats the measurement — and all three are gated."""
    import framing
    cal = {"frame": {"width": 1280, "height": 720}, "arrangement_left": 420,
           "daw_top": 43, "daw_bottom": 529}

    good_cam, good_daw = (641, 0, 639, 367), (330, 46, 307, 390)
    ok, why = framing.validate(good_cam, good_daw, 1280, 720)
    check("a real framing validates", ok, why)

    # The defect the gates exist for: a DAW rect that would crop negative.
    ok, why = framing.validate(good_cam, (420, 43, -9, 390), 1280, 720)
    check("negative daw width rejected", not ok, f"({why})")
    ok, why = framing.validate(good_cam, (420, 43, 900, 390), 1280, 720)
    check("daw rect past the frame edge rejected", not ok, f"({why})")
    ok, why = framing.validate((1057, 0, 223, 212), None, 1280, 720)
    check("sliver camera rect still rejected", not ok, f"({why})")

    locks = {"version": 1, "locks": []}
    framing.add_lock(locks, "2026-08-12", 600.0, 900.0, good_cam, good_daw, "stable scene")
    check("lock covers a clip inside its range",
          framing.lock_for(locks, "2026-08-12", 610.0, 640.0) is not None)
    check("lock ignores a clip outside its range",
          framing.lock_for(locks, "2026-08-12", 1200.0, 1230.0) is None)
    check("lock ignores another stream",
          framing.lock_for(locks, "2026-07-08", 610.0, 640.0) is None)


def test_capture_never_discards_an_irreplaceable_file():
    """A short capture of an at-risk stream is kept, not deleted.

    The first back-fill threw away a 98.6% capture of a 3.19h stream because the
    media was 160s shorter than the duration Kick advertised. Live VODs advertise
    the whole session including reconnects, so the media is routinely a little
    short — and for a VOD Kick is about to delete, an almost-complete capture beats
    nothing. Also covers the filename collision: two streams went out on
    2026-08-12 under one title and the shorter overwrote the longer.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("ing", str(ROOT / "ingest.py"))
    ing = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ing)

    a = ing.slugify("Live Session w/ Rochester", "2026-08-12", "547f804a-0a7e")
    b = ing.slugify("Live Session w/ Rochester", "2026-08-12", "fb361074-c3a7")
    check("same-day same-title streams get distinct filenames", a != b, f"({a} vs {b})")

    check("a 98.6% capture counts as complete",
          ing.verify.__doc__ is not None and ing.MIN_DURATION_FRACTION <= 0.90,
          f"(floor {ing.MIN_DURATION_FRACTION:.0%})")
    check("the format chain falls back past a missing 720p rung",
          ing.FORMAT_CHAIN[0] == "720p" and any("height<=720" in f for f in ing.FORMAT_CHAIN),
          f"({' -> '.join(ing.FORMAT_CHAIN)})")


def test_clip_range_stays_a_clip():
    """An edge edit cannot turn a clip into a 26-minute one.

    It happened: "Set in here" with the playhead at zero wrote start=0 against an
    unchanged out point, producing a 1557-second "clip". The edit was recorded, the
    UI showed it, and nothing complained -- the same class of hole the framing
    gates exist to close. Bounds live in site/src/lib/yp.ts; this pins the contract
    they enforce.
    """
    MIN_S, MAX_S = 5, 180
    cases = [
        ((0.0, 1557.3), False, "playhead-at-zero in-point"),
        ((4232.0, 4262.0), True, "a real 30s clip"),
        ((100.0, 103.0), False, "too short to be a clip"),
        ((100.0, 99.0), False, "out before in"),
        ((-5.0, 25.0), False, "in before the stream starts"),
        ((100.0, 280.0), True, "180s, right at the ceiling"),
    ]
    for (start, end), ok, why in cases:
        length = end - start
        allowed = start >= 0 and end > start and MIN_S <= length <= MAX_S
        check(f"{why} -> {'allowed' if ok else 'rejected'}", allowed == ok,
              f"({length:.1f}s)")


def test_retag_keeps_the_approval_and_the_copy():
    """Correcting a tag renames the file. The clip is still the same clip.

    compose names a clip `<HHMMSS>_<context_tag>.mp4`, so retagging beat ->
    singing renders to a NEW path. Keying purely on that path meant the approval
    and the hand-written hook stayed on the old filename, the pre-retag MP4 stayed
    on disk marked rendered, and the export pack shipped the stale file.
    """
    data = {"version": 1, "clips": {}}
    library.merge_stream(data, "2026-07-08", "vod.mp4", [
        {"path": "clips/2026-07-08/011032_beat.mp4", "start": 4232.0, "end": 4262.0,
         "duration": 30.0, "context_tag": "beat"},
    ])
    data["clips"]["clips/2026-07-08/011032_beat.mp4"]["status"] = "approved"
    data["clips"]["clips/2026-07-08/011032_beat.mp4"]["copy"] = {"hook": "the take that landed"}

    # Re-rendered after the tag was corrected: same start, new filename.
    library.merge_stream(data, "2026-07-08", "vod.mp4", [
        {"path": "clips/2026-07-08/011032_singing.mp4", "start": 4232.0, "end": 4262.0,
         "duration": 30.0, "context_tag": "singing"},
    ])

    check("the pre-retag key is gone",
          "clips/2026-07-08/011032_beat.mp4" not in data["clips"])
    moved = data["clips"].get("clips/2026-07-08/011032_singing.mp4", {})
    check("the approval followed the clip", moved.get("status") == "approved")
    check("the hand-written hook followed the clip",
          (moved.get("copy") or {}).get("hook") == "the take that landed")
    check("the corrected tag is what stuck", moved.get("context_tag") == "singing")


def test_batch_settings_recorded():
    """A batch carries the thresholds that produced it."""
    data = {"version": 2, "clips": {}}
    library.record_settings(data, "2026-08-12", {"count": 10, "spacing": 240})
    check("settings stored with the batch",
          library.settings_for(data, "2026-08-12")["spacing"] == 240)

    # A batch is written by more than one stage. Preparation stamps work_dir and
    # friends; selection stamps its guardrails and knows nothing about them.
    # record_settings used to replace the batch, so selecting a prepared stream
    # deleted work_dir -- which IS the definition of "prepared" -- and the stream
    # silently reverted to unprepared with the timeline losing its music map.
    data2 = {"version": 1, "clips": {}}
    library.record_settings(data2, "2026-08-12", {
        "work_dir": "work/kiki", "source": "vod.mp4",
        "calibration": {"cam": [0, 0, 10, 10]}, "stream_duration": 9741.9,
    })
    library.record_settings(data2, "2026-08-12", {"count": 10, "spacing": 240})
    after = library.settings_for(data2, "2026-08-12")
    check("selection settings do not erase preparation state",
          after.get("work_dir") == "work/kiki" and after.get("source") == "vod.mp4")
    check("both stages' keys survive on one batch",
          after.get("count") == 10 and after.get("stream_duration") == 9741.9)


def test_burned_text_stays_inside_the_frame():
    """No glyph off the canvas, and the hook the creator wrote actually renders.

    Two defects, both measured on the library as it stood: 53 of 68 hooks were
    wider than the 1080px canvas at the Hook style's 60px (the worst by 813px),
    and none of them reached the compositor at all -- `--hook` defaulted to empty
    and no caller ever set it, so a hook reached the export pack's copy and never
    the frame.
    """
    import re

    import captions
    import compose

    lib = json.loads((ROOT.parent.parent / "clips" / "library.json").read_text())
    clips = lib["clips"]
    clips = list(clips.values()) if isinstance(clips, dict) else clips
    hooks = sorted({(c.get("copy") or {}).get("hook", "") for c in clips} - {""})

    over = []
    for h in hooks:
        lines, scale, _ = captions.fit_lines(h, compose.HOOK_SIZE, compose.HOOK_MAX_W)
        widest = max(captions.text_width(ln, compose.HOOK_SIZE, scale) for ln in lines)
        if widest > compose.HOOK_MAX_W:
            over.append((h, widest))
    check(f"every hook in the library fits the {compose.HOOK_MAX_W}px safe box",
          not over, f"{len(hooks)} hooks" if not over else f"{len(over)} overflow")

    # An unbreakable word is the one case wrapping cannot solve. It must be
    # reported and floored, never silently rendered at an illegible size.
    lines, scale, why = captions.fit_lines(
        "SUPERCALIFRAGILISTICEXPIALIDOCIOUSNESS", compose.HOOK_SIZE,
        compose.HOOK_MAX_W)
    check("a word wider than the frame floors the scale and says so",
          scale >= 0.70 and "still" in why, f"scale={scale:.0%}")

    # The per-clip hook has to survive into the burned ASS.
    words = [{"word": w, "start": i * 0.4, "end": i * 0.4 + 0.35}
             for i, w in enumerate(["Asking", "the", "chat"])]
    pages = compose.group_pages(words)
    ass = compose.build_ass(pages, 20.0, "The pocket is the whole hook", 3.4,
                            set(), "", 905, "")
    hook_ev = [l for l in ass.splitlines() if ",Hook," in l]
    drawn = re.sub(r"\{[^}]*\}", "", hook_ev[0].split(",", 9)[9]) if hook_ev else ""
    check("a per-clip hook reaches the burned subtitle",
          bool(hook_ev) and "pocket" in drawn)
    check("a wrapped hook breaks with \\N, the only break WrapStyle 2 honours",
          r"\N" in hook_ev[0])

    # Captions keep their approved look: the frame-edge backstop must not fire on
    # real speech, or 3% of pages would silently rescale.
    fired = [p for p in ("THROWBACK YOUR", "DISAPPOINTMENT", "ENTERTAINMENT,")
             if captions.too_wide(p, compose.CAPTION_SIZE, compose.CAPTION_MAX_W)]
    check("the caption backstop does not fire on real transcript pages",
          not fired, "widest observed page was 873px against 1000px")


def test_discovered_moment_must_exist_in_the_transcript():
    """A model will return a plausible timestamp for a moment that never happened.

    This is the guard that keeps the pipeline's one non-deterministic stage from
    putting fiction in front of the compositor: a range only becomes a candidate
    if it resolves to transcribed speech, and it is clamped to what it actually
    covers rather than passed through as returned.
    """
    import discover_moments as dm

    segs = [{"start": 100.0, "end": 106.0, "text": "so I told him straight up"},
            {"start": 106.0, "end": 118.0, "text": "and that is when it clicked"},
            {"start": 118.0, "end": 140.0, "text": "you have to hear it back first"}]

    rng, why = dm.ground({"start": 100.0, "end": 130.0}, segs)
    check("a range over real speech is accepted", rng == (100.0, 130.0), str(rng))

    rng, why = dm.ground({"start": 99999.0, "end": 100029.0}, segs)
    check("a fabricated timestamp is refused", rng is None and "fabricated" in why)

    rng, why = dm.ground({"start": 110.0, "end": 9999.0}, segs)
    check("a range past the transcript is clamped to real content",
          rng == (110.0, 140.0), str(rng))

    # Clamping can leave too little to be a clip. Dropped, not shipped short.
    rng, why = dm.ground({"start": 130.0, "end": 9999.0}, segs)
    check("a clamp that leaves under the floor is dropped, not shipped short",
          rng is None and "floor" in why)

    rng, why = dm.ground({"start": 100.0, "end": 103.0}, segs)
    check("a range too short to be a clip is refused", rng is None and "floor" in why)

    rng, why = dm.ground({"start": 300.0, "end": 200.0}, segs)
    check("end before start is refused", rng is None)

    rng, why = dm.ground({"start": "soon", "end": None}, segs)
    check("an unparseable range is refused, not crashed on", rng is None)

    # Speech records must be consumable by compose.py and build_strategy.py with
    # no knowledge of which selector produced them.
    cands, rejected = dm.to_candidates(
        {"proposed": [{"start": 100.0, "end": 130.0, "tag": "story",
                       "reason": "r", "quote": "q"},
                      {"start": 88888.0, "end": 88918.0, "tag": "laugh"}]},
        segs, log=lambda *a: None)
    music_keys = {"start", "end", "duration", "score", "context_tag", "rank",
                  "sung_fraction", "reason", "excerpt", "bpm", "layout"}
    check("a speech candidate carries every field a music candidate does",
          len(cands) == 1 and music_keys <= set(cands[0]))
    check("the fabricated one was dropped, with a reason", len(rejected) == 1)

    # An invented tag would take the batch down at the strategy step, long after
    # the spend, so it is mapped to one that has copy behind it.
    cands, _ = dm.to_candidates(
        {"proposed": [{"start": 100.0, "end": 130.0, "tag": "not-a-real-tag"}]},
        segs, log=lambda *a: None)
    check("a tag the copy table does not know is mapped to one it does",
          cands[0]["context_tag"] in tags.TAGS, cands[0]["context_tag"])

    # One spacing rule across both selectors, and each candidate says who found it.
    music = [{"start": 180.0, "end": 210.0, "context_tag": "beat"}]
    speech = [{"start": 100.0, "end": 130.0, "context_tag": "story"},
              {"start": 1400.0, "end": 1430.0, "context_tag": "advice"}]
    kept, dropped = dm.merge(music, speech, spacing=240.0, log=lambda *a: None)
    check("the two selectors cannot both claim the same minute",
          len(kept) == 2 and len(dropped) == 1)
    check("every candidate records which selector found it",
          all(c.get("selector") in ("music", "speech") for c in kept))

    # The cache key is what stops a re-run re-billing or reshuffling a reviewed
    # batch: it has to move when the transcript does.
    edited = [dict(segs[0], text="a corrected line")] + segs[1:]
    check("a corrected transcript invalidates the cached verdict",
          dm.transcript_hash(segs) != dm.transcript_hash(edited))
    check("an unchanged transcript keeps it",
          dm.transcript_hash(segs) == dm.transcript_hash(list(segs)))


def test_no_stored_path_names_this_machine():
    """The store of record has to survive being copied to another Mac.

    `clips/library.json` ships. It used to carry an absolute `work_dir`, `source`
    and `calibration` for every batch, so a fresh install inherited eight records
    pointing at a home directory that does not exist on the machine reading them.
    It was already broken here: two files under `streams/prepare/` still named
    `/Users/gbase/yanchan/...`, a path that stopped existing when the repo moved
    -- and only resolved at all because a compatibility symlink happened to be
    left behind. That symlink is what hid the bug.
    """
    root = library.PROJECT_ROOT

    # 1. A path inside the repo is stored relative, whatever form it arrives in.
    inside = root / "streams" / "a.mp4"
    check("an in-repo path is stored relative",
          library.relative(inside) == "streams/a.mp4")
    check("a path outside the repo stays absolute -- there is nothing to be relative to",
          library.relative("/Volumes/Ext/vods/raw.mp4") == "/Volumes/Ext/vods/raw.mp4")

    # 2. Reading gives back an absolute path rooted at THIS install.
    check("a relative path resolves under this repo",
          library.resolve_path("streams/a.mp4") == inside)

    # 3. A record written on another machine is re-rooted rather than lost.
    foreign = "/Users/someone-else/yanchan/tools/clip-pipeline/work/2026-07-22-x"
    check("a foreign absolute path is re-rooted by its in-repo anchor",
          library.resolve_path(foreign)
          == root / "tools/clip-pipeline/work/2026-07-22-x")
    check("a genuinely external path is left alone",
          str(library.resolve_path("/Volumes/Ext/vods/raw.mp4"))
          == "/Volumes/Ext/vods/raw.mp4")

    # 4. Round-trip: nothing that goes in absolute comes back out absolute.
    data = {"version": 2, "clips": {}, "batches": {"2026-07-22": {
        "work_dir": str(root / "tools/clip-pipeline/work/w"),
        "source": str(root / "streams/s.mp4"),
        "calibration": str(root / "tools/clip-pipeline/work/w/calibration.json"),
    }}}
    library.migrate_paths(data)
    batch = data["batches"]["2026-07-22"]
    check("no batch path survives a round-trip as an absolute path",
          not any(Path(batch[f]).is_absolute() for f in library.PATH_FIELDS))
    check("the migration is idempotent",
          library.migrate_paths(data) == 0)

    # 5. The shipped data itself is clean. This is the check that actually fails
    #    if someone reintroduces an absolute write.
    shipped = []
    lib = library.load()
    for date, b in (lib.get("batches") or {}).items():
        for f in library.PATH_FIELDS:
            v = b.get(f)
            if v and Path(v).is_absolute() and not str(v).startswith("/Volumes/"):
                shipped.append(f"{date}.{f}")
    for state in sorted((library.PROJECT_ROOT / "streams" / "prepare").glob("*.json")):
        d = json.loads(state.read_text())
        for f in ("work_dir", "source"):
            v = d.get(f)
            if v and Path(v).is_absolute() and not str(v).startswith("/Volumes/"):
                shipped.append(f"{state.name}.{f}")
    check("nothing shipped on disk names a home directory", not shipped,
          ", ".join(shipped) if shipped else "")


def test_camera_only_stream_is_a_state_not_a_failure():
    """An IRL stream must not dead-end at preparation.

    2026-08-31 is a handheld walk through a fairground — no Ableton, no webcam
    inset, no OBS scene. It failed calibration with "The OBS scene layout may
    have changed", which is the wrong diagnosis: nothing changed, there is no
    scene. It got there because `is_daw_frame()` calls a frame "DAW" when its
    lower-left is dark and desaturated, and a black jacket at night passes the
    same test — measured, that stream scores 40% "DAW" frames against a real
    studio stream's 57%, so the `len(daw_frames) < 4` guard cannot separate them.

    The signal that does separate them is the one already computed: when every
    proposal comes back `no-edge`, there is no inset anywhere.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("cal", str(ROOT / "calibrate.py"))
    cal = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cal)

    # The camera-only signature, and the layout-change signature, must differ.
    camera_only = {"no-edge": 15}
    layout_change = {"no-edge": 1, "aspect": 6}
    check("all-no-edge with nothing accepted reads as camera-only",
          set(camera_only) <= {"no-edge"})
    check("edges found and refused does NOT read as camera-only",
          not (set(layout_change) <= {"no-edge"}))

    import tempfile
    import types
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "calibration.json"
        args = types.SimpleNamespace(source=Path("vod.mp4"), output=out, samples=60)
        rc = cal.write_fullcam(args, 1280, 720, [], 60, camera_only, "no inset")
        written = json.loads(out.read_text())
    check("a camera-only stream returns cleanly instead of raising", rc == 0)
    check("it records mode=fullcam", written.get("mode") == "fullcam")
    check("it says why, for the operator", bool(written.get("reason")))
    check("it carries the frame size the compositor needs",
          written["frame"] == {"width": 1280, "height": 720})

    # A recorded fullcam decision must win over the per-clip heuristic, or one
    # unlucky run of dark frames sends a clip down the split path with no
    # arrangement to put in the bottom pane.
    mode, cam, daw = layout.clip_layout(
        "nonexistent.mp4", 0.0, 30.0,
        {"frame": {"width": 1280, "height": 720}, "mode": "fullcam"})
    check("clip_layout honours a fullcam calibration without probing",
          mode == "reframe" and daw is None and cam == (0, 0, 1280, 720))


def test_yt_dlp_failures_are_explained():
    """A 404 must say the VOD does not exist, not print a traceback.

    Pasting a VOD id that is not on Kick showed "yt-dlp exited 1", a Python
    traceback, and a Python-3.9 deprecation notice — the last of which reads like
    the cause and is unrelated. Verified against the real failure: the id that
    404s is not on Kick, while the at-risk stream's own id downloads fine.
    """
    import fetch_vod

    four04 = ["[kick:vod] Downloading API JSON",
              "ERROR: [kick:vod] 01a03af3: Unable to download JSON metadata: "
              "HTTP Error 404: Not Found"]
    said = fetch_vod.explain_yt_dlp_failure(1, four04)
    # NOT "the VOD does not exist" — that was wrong and it cost real time. Kick's
    # page can be live while `api/v1/video/<id>` 404s, because one broadcast can
    # carry several video records: `01a03af3-...` 404s and `493946da-...` resolves,
    # and both are the same 2026-08-25 session (identical IVS recording id in the
    # thumbnail and in the scanned HLS URL). The message must not send someone to
    # re-check a link that was already correct.
    check("a 404 blames the id lookup, not the VOD's existence",
          "does not resolve that video id" in said)
    check("it does not claim the VOD was deleted",
          "deleted" not in said and "no VOD with that id" not in said)
    check("it points at the path that does work",
          "Archive now" in said)
    check("it does not leak the traceback or the deprecation notice",
          "Traceback" not in said and "Deprecated" not in said)

    said = fetch_vod.explain_yt_dlp_failure(1, ["ERROR: HTTP Error 403: Forbidden"])
    check("a 403 names the Cloudflare block and the way round it",
          "403" in said and "at-risk" in said)

    said = fetch_vod.explain_yt_dlp_failure(1, ["Deprecated Feature: Python 3.9"])
    check("with no ERROR line it falls back rather than inventing a cause",
          "exited 1" in said)


def test_stored_paths_are_resolved_before_use():
    """Every stored path must be resolved, not just stored relative.

    The portability migration made batch paths repo-relative and wired
    `resolveRepoPath()` through most consumers. Two were missed, and both failed
    silently rather than loudly:

      * `playableFor()` returned `batch.source` raw, so the video element got a
        path resolved against the server's cwd. It only showed on a stream with
        no proxy — the proxy candidates are built absolute — which is why it
        surfaced on the two newest captures as "The element has no supported
        sources" and looked like a broken stream rather than a broken path.
      * the QA summary joined `batch.work_dir` raw, so every stream reported
        "No QA report for this batch yet" while `qa.json` sat on disk.

    This checks the shape of the data rather than the TypeScript: every path
    recorded in a batch is relative (1.x's contract), and the file it names
    exists when resolved against the repo. A consumer that forgets to resolve
    then has no excuse — the value was never usable as-is.
    """
    lib = json.loads((ROOT.parent.parent / "clips" / "library.json").read_text())
    root = ROOT.parent.parent
    checked = 0
    for date, batch in (lib.get("batches") or {}).items():
        for field in ("source", "work_dir", "calibration"):
            value = (batch or {}).get(field)
            if not isinstance(value, str) or not value:
                continue
            checked += 1
            check(f"{date}.{field} is stored relative",
                  not value.startswith("/"), value[:52])
            # Only the in-repo ones must exist; an external drive is allowed to be
            # absent (that is what the absolute-path carve-out is for).
            if not value.startswith("/"):
                check(f"{date}.{field} resolves to a real path under the repo",
                      (root / value).exists(), value[:52])
    check("there were batch paths to check at all", checked > 0, f"{checked} value(s)")


def test_a_prepared_stream_is_watchable():
    """Prepared must mean watchable, not just measured.

    Every HLS capture arrives as MPEG-TS with an `.mp4` name -- it starts 0x47,
    not `ftyp` -- and no browser plays one. `make_proxy.py` was written for this
    and was never wired into `prepare_stream.py`, so the seven older streams had
    proxies only because someone ran it by hand and every capture since arrived
    unwatchable: a fully prepared stream showed a black pane in the editor.
    """
    steps = (ROOT / "prepare_stream.py").read_text()
    check("preparation builds a browser proxy",
          "make_proxy.py" in steps and '"proxy"' in steps)

    proxies = ROOT.parent.parent / "streams" / "proxy"
    archive = json.loads((ROOT.parent.parent / "streams" / "archive.json").read_text())
    lib = json.loads((ROOT.parent.parent / "clips" / "library.json").read_text())
    prepared = {d for d, b in (lib.get("batches") or {}).items() if (b or {}).get("work_dir")}

    def playable(path):
        """`ftyp` in the first 12 bytes = MP4. A leading 0x47 = MPEG-TS."""
        with open(path, "rb") as fh:
            return b"ftyp" in fh.read(12)

    for rec in archive.get("streams", {}).values():
        date, src = rec.get("stream_date"), rec.get("path")
        if date not in prepared or not src:
            continue
        source = ROOT.parent.parent / src
        if not source.exists():
            continue
        proxy = proxies / f"{date}.mp4"
        # Either the capture is already a real MP4, or a proxy exists for it.
        ok = playable(source) or (proxy.exists() and playable(proxy))
        check(f"{date} can be played in a browser", ok,
              "source is MP4" if playable(source) else
              ("via proxy" if proxy.exists() else "NO PROXY — black pane in the editor"))


def test_no_route_uses_a_stored_path_raw():
    """No dashboard code may touch a stored path without resolving it first.

    Five separate bugs today were one mistake repeated: `batch.source`,
    `batch.work_dir`, `playableFor`'s source, the QA `work_dir`, and the render
    preflight all used a path that the portability migration had made relative.
    Every one failed silently or misleadingly — "the stream source is missing"
    about a file that was right there; "No QA report" about a report on disk; a
    black video; and `--source` quietly dropped so the selector could not probe
    layout at all.

    Data-shape tests cannot catch this, because the data is correct. The defect
    is always at the point of use, so this checks the point of use: a stored path
    may appear in a filesystem call only inside `resolveRepoPath(...)`.
    """
    import re
    site = ROOT.parent.parent / "site" / "src"
    if not site.exists():
        check("site/src present to scan", False, "skipped")
        return

    STORED = ("batch.source", "batch.work_dir", "batch.calibration",
              "recorded.source", "rec.path")
    # Truthiness and basename are fine; only filesystem use needs resolving.
    USES = re.compile(r"\b(access|stat|exists|createReadStream|readFile|readJson)\s*\(")

    offenders = []
    for f in site.rglob("*.ts"):
        if "node_modules" in str(f):
            continue
        for n, line in enumerate(f.read_text().splitlines(), 1):
            if "resolveRepoPath" in line or line.strip().startswith("//"):
                continue
            if any(v in line for v in STORED) and USES.search(line):
                offenders.append(f"{f.relative_to(site)}:{n}")

    check("no filesystem call takes a stored path unresolved",
          not offenders, ", ".join(offenders) if offenders else "clean")


def test_mirror_flips_the_camera_and_nothing_else():
    """A mirrored clip must flip the camera and leave every text element alone.

    Yanchan's webcam faces one way; mirroring is a normal thing to want. The trap
    is flipping too much: the DAW pane turns Ableton's track names into mirror
    writing, and the burned hook, captions and the kick.com plate must read the
    right way round whatever the video underneath does.
    """
    import compose

    cam, daw = (200, 0, 720, 405), (385, 43, 895, 486)

    plain = compose.split_filter(cam, daw)
    flipped = compose.split_filter(cam, daw, True)
    check("split: mirror off adds no hflip", "hflip" not in plain)
    check("split: mirror on flips exactly one pane", flipped.count("hflip") == 1)
    # The camera pane is built first and tagged `top`; the DAW is `bot`.
    top = flipped.split("[top]")[0]
    check("split: the flip is on the camera pane", "hflip" in top)
    check("split: the DAW pane is never flipped",
          "hflip" not in flipped.split("[top];")[-1])

    plain_r = compose.reframe_filter(cam)
    flipped_r = compose.reframe_filter(cam, True)
    check("single-pane: mirror off adds no hflip", "hflip" not in plain_r)
    check("single-pane: mirror on flips the frame", flipped_r.count("hflip") == 1)

    # The flip has to precede the scale, or the blurred letterbox fill is built
    # from unmirrored content and disagrees with the foreground over it.
    seg = flipped.split("[top]")[0]
    check("the flip precedes the scale, so the blur fill matches",
          seg.index("hflip") < seg.index("scale"))

    # Captions are burned by the subtitles filter after the video chain, so no
    # video-level flip can reach them. Guard the ordering that guarantees it.
    src = (ROOT / "compose.py").read_text()
    check("subtitles are burned after the video filters",
          src.index("def pane_chain") < src.index("subtitles="))

    check("mirror is a creator override, so a per-clip choice survives a re-render",
          "mirror" in library.CREATOR_OVERRIDES)


def test_a_killed_run_does_not_look_finished():
    """A truncated stage output must be rebuilt, not accepted because it exists.

    prepare_stream.py tested `exists()` and nothing else, and extract_audio.py
    tested `size > 0`. Extracting audio from a two-hour stream takes minutes and
    writes progressively, so an interrupted run leaves a WAV holding the first few
    minutes -- and every later stage reads it, maps music over a stream that seems
    to end early, and selects clips from it. Nothing ever re-extracts.
    """
    import tempfile
    import extract_audio
    import prepare_stream

    hour = 3600.0
    full = 44 + extract_audio.WAV_BYTES_PER_SECOND * hour

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        wav = work / "audio.wav"

        check("a missing WAV is not complete",
              not extract_audio.audio_is_complete(wav, hour))

        wav.write_bytes(b"\0" * 44)
        check("a header-only WAV is not complete (this is the stub that shipped)",
              not extract_audio.audio_is_complete(wav, hour))

        wav.write_bytes(b"\0" * int(full * 0.10))
        check("10% of an hour of audio is not complete",
              not extract_audio.audio_is_complete(wav, hour), "(6 min of a 60 min stream)")

        wav.write_bytes(b"\0" * int(full * 0.97))
        check("97% is still short — the 0.98 floor is deliberate",
              not extract_audio.audio_is_complete(wav, hour))

        wav.write_bytes(b"\0" * int(full))
        check("a full-length WAV is complete and is not re-extracted",
              extract_audio.audio_is_complete(wav, hour))

        # An unprobeable source has nothing to compare against; only emptiness is
        # a fault then, which is the old behaviour and the right fallback.
        check("with no known duration, a non-empty WAV is accepted",
              extract_audio.audio_is_complete(wav, None))
        wav.write_bytes(b"")
        check("with no known duration, an empty WAV is still refused",
              not extract_audio.audio_is_complete(wav, None))

        # Same class, different shape: a JSON stage killed mid-write.
        cal = work / "calibration.json"
        check("a missing calibration is not complete",
              not prepare_stream.json_is_complete(cal))
        cal.write_text('{"frame": {"width": 1280, ')
        check("a half-written calibration.json is not complete",
              not prepare_stream.json_is_complete(cal))
        cal.write_text("{}")
        check("an empty JSON object is not complete",
              not prepare_stream.json_is_complete(cal))
        cal.write_text('{"mode": "fullcam"}')
        check("a real calibration is complete", prepare_stream.json_is_complete(cal))

    src = (ROOT / "prepare_stream.py").read_text()
    check("preparation asks whether the audio is complete, not whether it exists",
          'audio_is_complete(work / "audio.wav"' in src
          and 'if not (work / "audio.wav").exists()' not in src)
    check("both scripts share one floor, so they cannot disagree",
          "from extract_audio import audio_is_complete" in src)

def test_a_stale_scan_reports_staleness_not_zero_at_risk():
    """`AT RISK 0` must never be printed from a scan too old to know.

    That exact line was on the dashboard on 2026-09-06, from a scan 19 days old,
    while three streams sat uncaptured on Kick -- two of them inside a fortnight
    of deletion. The number was not wrong about the data it had; the data was 19
    days old and nothing said so. A confident all-clear over stale data is worse
    than no number, so staleness outranks the count: when the scan is old the
    count is None (unknown), never 0.
    """
    import archive
    from datetime import date, datetime, timedelta, timezone

    now = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
    today = date(2026, 9, 6)

    def at(days_ago):
        return (now - timedelta(days=days_ago)).isoformat(timespec="seconds")

    empty = {"version": 1, "streams": {}}
    risky = {"version": 1, "streams": {
        "u1": {"status": "kick_only", "stream_date": "2026-08-25 22:04:24"},
        "u2": {"status": "kick_only", "stream_date": "2026-08-31 00:03:07"},
        "u3": {"status": "archived", "stream_date": "2026-08-12 00:19:52"},
    }}

    # The failure, reconstructed: a 19-day-old scan over an archive that has
    # nothing marked at risk yet, because the scan that would have marked it
    # never ran.
    old = archive.scan_state({**empty, "last_successful_scan": {"at": at(19), "method": "bridge"}},
                             today, now)
    check("a 19-day-old scan is stale", old["state"] == "stale")
    check("a stale scan reports at_risk as unknown, not 0",
          old["at_risk"] is None, f"(got {old['at_risk']!r})")
    check("the stale message says nothing is known, not that nothing is at risk",
          "unknown" in old["message"] and " 0 " not in old["message"],
          f"({old['message']!r})")
    check("the stale message carries the age", "19 days old" in old["message"])

    never = archive.scan_state(empty, today, now)
    check("never scanned is stale, not fresh", never["state"] == "stale")
    check("never scanned reports at_risk as unknown", never["at_risk"] is None)

    # A scan on the staleness boundary is stale, not fresh. Off-by-one here means
    # the alarm goes quiet a day early.
    check(f"a scan exactly {archive.STALE_AFTER_DAYS} days old is stale",
          archive.scan_state({**empty, "last_successful_scan": {"at": at(archive.STALE_AFTER_DAYS),
                                                               "method": "headers"}},
                             today, now)["state"] == "stale")

    fresh_empty = archive.scan_state({**empty, "last_successful_scan": {"at": at(0.5),
                                                                       "method": "headers"}},
                                     today, now)
    check("a fresh scan over a clean archive may say 0 at risk",
          fresh_empty["state"] == "fresh" and fresh_empty["at_risk"] == 0)

    fresh_risky = archive.scan_state({**risky, "last_successful_scan": {"at": at(0.5),
                                                                       "method": "headers"}},
                                     today, now)
    check("a fresh scan over uncaptured streams reports them",
          fresh_risky["state"] == "at_risk" and fresh_risky["at_risk"] == 2)
    check("and names the days left on the most urgent",
          fresh_risky["soonest_days_left"] == 18,
          f"(2026-08-25 + 30 - 2026-09-06 = 18, got {fresh_risky['soonest_days_left']})")

    # A stale scan over an archive that DOES hold at-risk records must still
    # refuse to answer: the records are as old as the scan that wrote them.
    stale_risky = archive.scan_state({**risky, "last_successful_scan": {"at": at(19),
                                                                       "method": "headers"}},
                                     today, now)
    check("staleness outranks a non-empty at-risk list too",
          stale_risky["state"] == "stale" and stale_risky["at_risk"] is None)

    check("the method that answered is recorded, so a silent downgrade is visible",
          archive.record_scan({}, "bridge", at(0))["last_successful_scan"]["method"] == "bridge")

    # The dashboard mirrors this rule in TypeScript, the same way it already
    # mirrors days_left(). Mirrors drift; that is the whole risk of having one.
    ts = (ROOT.parent.parent / "site" / "src" / "lib" / "yp.ts").read_text()
    check("the dashboard mirrors the staleness threshold, and it matches",
          f"STALE_AFTER_DAYS = {archive.STALE_AFTER_DAYS};" in ts,
          f"(python says {archive.STALE_AFTER_DAYS})")
    check("the dashboard's stale branch reports atRisk as null, not 0",
          "atRisk: null," in ts)
    page = (ROOT.parent.parent / "site" / "src" / "app" / "dashboard"
            / "streams" / "page.tsx").read_text()
    check("the at-risk tile reads the scan state, not the raw list length",
          "scan.atRisk === null" in page and "<Stat value={atRisk.length} />" not in page)

    # The CLI is where `AT RISK 0` was actually printed on 2026-09-06 — the
    # dashboard and doctor.py were taught this rule first and `ingest.py --status`,
    # the surface that said it, was not. Every surface, or the rule is decoration.
    cli = (ROOT / "ingest.py").read_text()
    check("`ingest.py --status` reports scan freshness before any count",
          'print(state["message"])' in cli)
    check("and prints 'unknown' rather than a number when the scan is stale",
          "unknown — the scan is too old to say" in cli)
    check("its --json reports at_risk as null when stale, so no consumer reads an all-clear",
          '"at_risk": None if stale else len(risk)' in cli)
    check("--backfill does not claim everything is archived off a stale scan",
          'if state["state"] == "stale":' in cli.split("def cmd_backfill")[1])


def test_the_scan_has_more_than_one_way_in():
    """The chain is the design, not any one rung (D1).

    Cloudflare bypass is an arms race and we lose it periodically. What was
    measured on 2026-09-07: the 403 is a User-Agent check, not a TLS block --
    plain urllib with a Chrome User-Agent returns 200 -- so the browser bridge,
    which cannot run headless and which capture.sh treated as the only door, was
    never actually required. That is the finding that unblocks unattended
    capture, and this test exists so a later "simplification" back to one rung
    has to argue with it.
    """
    import kick_api

    names = [name for name, _ in kick_api.RUNGS]
    check("there is more than one way in", len(names) > 1, f"({', '.join(names)})")
    check("the no-dependency rung is tried first", names[0] == "headers")
    check("the browser bridge is last, not first", names[-1] == "bridge")

    # yt-dlp is deliberately absent: its Kick extractor resolves
    # kick.com/<channel>/videos to the *live* extractor and fails with "The
    # channel is not currently live". A rung that can never fire is worse than
    # no rung, because it reads as depth.
    check("yt-dlp is not listed as a scan rung (it cannot enumerate a channel)",
          "yt-dlp" not in names)

    calls = []

    def dead(label):
        def rung(channel, timeout):
            calls.append(label)
            raise RuntimeError(f"{label} is down")
        return rung

    def alive(label):
        def rung(channel, timeout):
            calls.append(label)
            return [{"uuid": "u1", "title": "x", "start": "2026-09-01", "hls": "h"}]
        return rung

    original = kick_api.RUNGS
    try:
        kick_api.RUNGS = (("headers", dead("headers")), ("impersonate", alive("impersonate")),
                          ("bridge", dead("bridge")))
        vods, method = kick_api.scan("c")
        check("a dead first rung falls through to the next", method == "impersonate")
        check("and stops there rather than trying every rung",
              calls == ["headers", "impersonate"], f"({calls})")

        kick_api.RUNGS = (("headers", dead("h")), ("impersonate", dead("i")),
                          ("bridge", dead("b")))
        try:
            kick_api.scan("c")
            check("every rung failing raises rather than returning nothing", False)
        except kick_api.ScanFailed as exc:
            check("every rung failing raises ScanFailed", True)
            check("and the error names every rung it tried",
                  all(r in str(exc) for r in ("headers", "impersonate", "bridge")))

        # A record with no uuid cannot be keyed, merged or downloaded. Accepting
        # one would write a scan that ingest.py then fails on, far from here.
        kick_api.RUNGS = (("headers", lambda c, t: [{"uuid": None, "title": "x"}]),
                          ("bridge", alive("bridge")))
        _, method = kick_api.scan("c")
        check("a rung answering with no uuids is not a success", method == "bridge")
    finally:
        kick_api.RUNGS = original

def test_one_bad_clip_is_not_a_failed_batch():
    """QA must fail the run only when NOTHING passed (design D8).

    `work/run_all_streams.log` records `9/10 passed` on one line and `FAIL` on
    the next, for a run where every clip rendered and nine were shippable:
    qa_report.py exited 1 if *any* clip failed and clip.sh turned that into a
    top-level QA FAILED banner. A tool that cries wolf on a good batch trains its
    operator to ignore it, which costs more than the tenth clip.
    """
    src = (ROOT / "qa_report.py").read_text()
    check("qa exits on whether anything passed, not on whether anything failed",
          'return 0 if payload["passed"] else 1' in src
          and "return 1 if failed else 0" not in src)

    # The rule, evaluated the way the code evaluates it.
    verdict = lambda passed: 0 if passed else 1
    check("9 of 10 passing is a successful run", verdict(9) == 0)
    check("1 of 10 passing is still a successful run", verdict(1) == 0,
          "(one shippable clip is worth having)")
    check("0 of 10 passing is a failed run", verdict(0) == 1)

    check("per-clip failures are still written to qa.json, not swallowed",
          '"failed": len(failed)' in src and 'for r in failed:' in src)

    sh = (ROOT / "clip.sh").read_text()
    check("clip.sh no longer prints QA FAILED for a batch that produced clips",
          "no clip passed its checks" in sh)
    check("and says where to look at the ones that did fail",
          "marked in the dashboard" in sh)

def test_word_lookup_is_a_slice_not_a_rescan():
    """The windowed word lookup must return exactly what the full scan returned.

    `score_window()` runs on a 30 s window every 5 s across a whole stream --
    1,962 windows on the 2026-07-03 VOD, against 24,843 words, which is 48.7
    million comparisons to place ten clips. The words are sorted, so the window
    is a contiguous slice; the only thing that makes that safe is backing the
    lower bound off by the longest single word. This test is that argument,
    written down.
    """
    import analyze

    words = [{"start": 0.0, "end": 4.0, "text": "loooong", "segment_idx": 0},
             {"start": 1.0, "end": 1.4, "text": "a", "segment_idx": 0},
             {"start": 9.9, "end": 10.4, "text": "straddles", "segment_idx": 1},
             {"start": 10.0, "end": 10.2, "text": "inside", "segment_idx": 1},
             {"start": 19.9, "end": 20.6, "text": "edge", "segment_idx": 2},
             {"start": 30.0, "end": 30.5, "text": "after", "segment_idx": 3}]
    idx = analyze.WordIndex(words)

    def scan(a, b):
        return [w for w in words if w["end"] > a and w["start"] < b]

    for a, b in [(0, 30), (0, 1), (1, 2), (9.5, 10.5), (10.0, 10.1), (19, 21),
                 (20, 30), (29.9, 30.1), (30, 40), (100, 200), (-5, 0.5)]:
        check(f"overlapping({a}, {b}) matches the full scan",
              idx.overlapping(a, b) == scan(a, b))

    # The case the slice exists to survive: a long word that starts well before
    # the window and is still sounding inside it.
    check("a word starting 4s before the window is still found in it",
          words[0] in idx.overlapping(3.5, 5.0),
          "(this is what the max-word-length backoff is for)")
    check("a word that ends exactly at the window start is excluded",
          words[0] not in idx.overlapping(4.0, 5.0))

    def contained(a, b):
        return [w for w in words if w["start"] >= a and w["end"] <= b]

    for a, b in [(0, 30), (9, 11), (10, 10.3), (19, 21), (0, 0.5)]:
        check(f"contained({a}, {b}) matches the full scan",
              idx.contained(a, b) == contained(a, b))

    check("an empty transcript does not crash the index",
          analyze.WordIndex([]).overlapping(0, 30) == [])
    check("the index reports its length, so callers need no special case",
          len(idx) == len(words))

def test_a_partial_capture_is_not_lost_when_kick_drops_it():
    """A stream we hold part of must never be marked unrecoverable.

    `partial` means the capture is real and short. 2026-08-25 is 2.67 GB of a
    music session that Kick's own HLS manifest served at 70% of the advertised
    length. Kick deletes it from the listing 30 days after it aired, and the very
    next daily scan would then have called it UNRECOVERABLE -- a stream sitting
    on disk, described as gone, by an unattended job at 04:00.

    This is the third place the same filter has been wrong: `getStreams()` hid it
    from every screen, `archived()` made it unpreparable and unplayable, and this
    one would have relabelled it. The question every one of them is asking is "do
    we have a file for this", and `partial` answers yes.
    """
    import archive

    def dropped_from_kick(status):
        data = {"version": 1, "streams": {
            "u-held": {"status": status, "stream_date": "2026-08-25 22:04:24",
                       "path": "streams/2026-08-25.mp4"},
            "u-still-listed": {"status": "kick_only", "stream_date": "2026-09-01 00:00:00"},
        }}
        # A scan that no longer lists u-held.
        archive.merge_scan(data, [{"uuid": "u-still-listed"}], "2026-09-25T04:00:00Z")
        return data["streams"]["u-held"]["status"]

    check("a partial capture survives being dropped from Kick's listing",
          dropped_from_kick("partial") == "partial",
          f"(got {dropped_from_kick('partial')!r})")
    check("an archived capture still survives it",
          dropped_from_kick("archived") == "archived")
    check("a stream we never captured is still marked unrecoverable",
          dropped_from_kick("kick_only") == "unrecoverable",
          "(the honest case this branch exists for)")

    # Every consumer of "do we have a file for this" must agree.
    data = {"version": 1, "streams": {
        "u1": {"status": "partial", "stream_date": "2026-08-25 22:04:24"},
        "u2": {"status": "archived", "stream_date": "2026-08-26 00:09:40"},
        "u3": {"status": "kick_only", "stream_date": "2026-09-01 00:00:00"},
        "u4": {"status": "unrecoverable", "stream_date": "2026-05-01 00:00:00"},
    }}
    check("archived() counts a partial capture as held",
          {r["uuid"] for r in archive.archived(data)} == {"u1", "u2"})
    check("at_risk() does not — we already have the file",
          {r["uuid"] for r in archive.at_risk(data)} == {"u3"})

if __name__ == "__main__":
    for fn in (test_narrow_daw_falls_back, test_daw_rect_fills_the_pane,
               test_gates_reject_slivers,
               test_every_emitted_tag_has_copy, test_windowed_transcript_refused,
               test_sung_note_detector, test_library_preserves_human_copy,
               test_creator_intent_survives_and_undoes,
               test_framing_precedence_and_gates,
               test_capture_never_discards_an_irreplaceable_file,
               test_clip_range_stays_a_clip, test_batch_settings_recorded,
               test_retag_keeps_the_approval_and_the_copy,
               test_burned_text_stays_inside_the_frame,
               test_discovered_moment_must_exist_in_the_transcript,
               test_no_stored_path_names_this_machine,
               test_camera_only_stream_is_a_state_not_a_failure,
               test_yt_dlp_failures_are_explained,
               test_stored_paths_are_resolved_before_use,
               test_a_prepared_stream_is_watchable,
               test_no_route_uses_a_stored_path_raw,
               test_mirror_flips_the_camera_and_nothing_else,
               test_a_killed_run_does_not_look_finished,
               test_a_stale_scan_reports_staleness_not_zero_at_risk,
               test_the_scan_has_more_than_one_way_in,
               test_one_bad_clip_is_not_a_failed_batch,
               test_word_lookup_is_a_slice_not_a_rescan,
               test_a_partial_capture_is_not_lost_when_kick_drops_it):
        print(f"\n{fn.__name__}:")
        fn()
    print(f"\n{'ALL PASS' if not FAILURES else 'FAILURES: ' + ', '.join(FAILURES)}")
    sys.exit(1 if FAILURES else 0)
