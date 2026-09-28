import { access, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Server-side reader for the clip pipeline's artifacts.
 *
 * Everything the dashboard shows is produced by `tools/clip-pipeline/` and lives
 * in files. This module is the single place that knows where they are — pages and
 * API routes go through it rather than rebuilding paths, because a consumer that
 * reconstructs a path from a naming convention breaks silently when the
 * convention changes. That is exactly how the clip previews came to 404.
 */

const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
export const FILES = {
  archive: path.join(/*turbopackIgnore: true*/ REPO, "streams", "archive.json"),
  library: path.join(/*turbopackIgnore: true*/ REPO, "clips", "library.json"),
  locks: path.join(/*turbopackIgnore: true*/ REPO, "clips", "framing-locks.json"),
  settings: path.join(/*turbopackIgnore: true*/ REPO, "clips", "selection-settings.json"),
  transcripts: path.join(/*turbopackIgnore: true*/ REPO, "transcripts"),
  work: path.join(/*turbopackIgnore: true*/ REPO, "tools", "clip-pipeline", "work"),
};

/**
 * Batch records store paths relative to the repo so `library.json` survives being
 * copied to another machine — it ships, and it used to carry this machine's home
 * directory in every batch. Absolute values are still accepted: a file on an
 * external drive is legitimately absolute, and a library written before the
 * change is re-rooted here by its first in-repo anchor rather than silently
 * resolving to nothing. Mirrors `library.resolve_path()` on the Python side.
 */
const REPO_ANCHORS = ["streams/", "clips/", "transcripts/", "tools/clip-pipeline/"];

export function resolveRepoPath(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!path.isAbsolute(value)) {
    return path.join(/*turbopackIgnore: true*/ REPO, value);
  }
  if (existsSync(value)) return value;
  const s = value.replace(/\\/g, "/");
  for (const a of REPO_ANCHORS) {
    const i = s.lastIndexOf("/" + a);
    if (i !== -1) {
      return path.join(/*turbopackIgnore: true*/ REPO, s.slice(i + 1));
    }
  }
  return value;
}

export type StreamRecord = {
  uuid: string;
  title?: string;
  stream_date?: string;
  duration_s?: number;
  measured_duration_s?: number;
  bytes?: number;
  resolution?: string;
  // `partial` is a capture that is real and short: 2026-08-25 came down at 70%
  // of its advertised length because Kick's own HLS manifest is short, twice,
  // identically. The 0.90 guard is right to refuse "archived" and "unrecoverable"
  // is the wrong word for 72 usable minutes of a music session (task 2.12).
  status?: "kick_only" | "archived" | "partial" | "unrecoverable";
  note?: string;
  path?: string | null;
  fetch_method?: string;
  captured_at?: string;
  source_hls?: string;
  slug?: string;
};

export type Clip = {
  path: string;
  date?: string;
  start: number;
  end: number;
  duration: number;
  context_tag: string;
  /** Which selector proposed this clip: "music", "speech", or "hand". */
  selector?: string;
  score?: number;
  mode?: string;
  excerpt?: string;
  bpm?: number | null;
  sung_fraction?: number | null;
  stream_duration?: number | null;
  status?: string;
  scheduled?: string;
  framing_origin?: string;
  /** Measured pane rectangles, in source pixels. */
  cam?: [number, number, number, number] | null;
  daw?: [number, number, number, number] | null;
  copy?: { hook?: string; hook_alt?: string; caption?: string };
  creator?: Record<string, unknown>;
  history?: { field: string; from: unknown; to: unknown; note?: string }[];
};

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** Kick deletes a non-verified channel's VODs after ~30 days. */
export const RETENTION_DAYS = 30;

export function daysLeft(rec: StreamRecord, today = new Date()): number {
  if (!rec.stream_date) return NaN;
  const d = new Date(`${rec.stream_date}T00:00:00Z`);
  const age = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  return RETENTION_DAYS - age;
}

/**
 * Mirrors `archive.STALE_AFTER_DAYS`. `daysLeft` above already mirrors
 * `archive.days_left` the same way; the guard test fails if either drifts.
 */
export const STALE_AFTER_DAYS = 3;

export type ScanState = {
  state: "fresh" | "stale" | "at_risk";
  ageDays: number | null;
  lastScan: string | null;
  method: string | null;
  /** null means UNKNOWN. A stale scan must never report 0. */
  atRisk: number | null;
  soonestDaysLeft: number | null;
  message: string;
};

/**
 * How old is the answer this screen is about to show?
 *
 * On 2026-09-06 this screen read `AT RISK 0` off a scan 19 days old, while three
 * streams sat uncaptured on Kick — two of them inside a fortnight of deletion.
 * The count was not wrong about the data it had; the data was nineteen days old
 * and nothing said so. So staleness outranks the count: when the scan is old the
 * number is unknown, never zero.
 */
export function scanState(
  lastScan: { at?: string; method?: string } | null | undefined,
  atRisk: StreamRecord[],
  now = new Date()
): ScanState {
  const at = lastScan?.at ?? null;
  const parsed = at ? new Date(at) : null;
  const ageDays =
    parsed && !Number.isNaN(parsed.getTime())
      ? (now.getTime() - parsed.getTime()) / 86_400_000
      : null;
  const base = { ageDays, lastScan: at, method: lastScan?.method ?? null };

  if (ageDays === null || ageDays >= STALE_AFTER_DAYS) {
    const howOld =
      ageDays === null
        ? "Kick has never been scanned on this machine."
        : `The last Kick scan is ${Math.round(ageDays)} days old.`;
    return {
      ...base,
      state: "stale",
      atRisk: null,
      soonestDaysLeft: null,
      message: `${howOld} What is at risk right now is unknown until it scans again.`,
    };
  }

  if (atRisk.length > 0) {
    const soonest = daysLeft(atRisk[0]);
    return {
      ...base,
      state: "at_risk",
      atRisk: atRisk.length,
      soonestDaysLeft: soonest,
      message: `${atRisk.length} stream${atRisk.length === 1 ? "" : "s"} on Kick ${
        atRisk.length === 1 ? "is" : "are"
      } not captured. The most urgent has ${soonest} day${soonest === 1 ? "" : "s"} left.`,
    };
  }

  return {
    ...base,
    state: "fresh",
    atRisk: 0,
    soonestDaysLeft: null,
    message: `Scanned ${Math.round(ageDays * 24)}h ago via ${
      lastScan?.method ?? "an unknown method"
    }. Nothing at risk.`,
  };
}

export async function getStreams() {
  const data = await readJson<{
    streams?: Record<string, StreamRecord>;
    last_successful_scan?: { at?: string; method?: string; vods_seen?: number };
  }>(FILES.archive, {});
  const all = Object.entries(data.streams ?? {}).map(([uuid, r]) => ({ ...r, uuid }));
  const atRisk = all
    .filter((r) => r.status === "kick_only")
    .sort((a, b) => daysLeft(a) - daysLeft(b));
  return {
    scan: scanState(data.last_successful_scan, atRisk),
    // A partial capture has a usable file, so it belongs with the archived ones
    // rather than nowhere — filtering only on "archived" made it disappear from
    // every screen while sitting on disk.
    archived: all
      .filter((r) => r.status === "archived" || r.status === "partial")
      .sort((a, b) => (b.stream_date ?? "").localeCompare(a.stream_date ?? "")),
    atRisk,
    unrecoverable: all.filter((r) => r.status === "unrecoverable"),
  };
}

/** Creator edits override the measured values — the same rule the renderer uses. */
export function resolveClip(clip: Clip): Clip {
  const creator = (clip.creator ?? {}) as Record<string, unknown>;
  const out: Clip = { ...clip };
  for (const field of ["start", "end", "context_tag", "framing", "hook", "output_mode"]) {
    if (creator[field] !== undefined && creator[field] !== null) {
      (out as Record<string, unknown>)[field] = creator[field];
    }
  }
  out.duration = out.end - out.start;
  return out;
}

export async function getLibrary() {
  const data = await readJson<{
    clips?: Record<string, Clip>;
    batches?: Record<string, Record<string, unknown>>;
  }>(FILES.library, {});
  const clips = Object.entries(data.clips ?? {})
    .map(([p, c]) => resolveClip({ ...c, path: p }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.start - b.start);
  return { clips, batches: data.batches ?? {} };
}

export async function getClipsForStream(date: string) {
  const { clips } = await getLibrary();
  return clips.filter((c) => c.date === date);
}

/** Per-second music and vocal curves, for the timeline's music lane. */
export async function getMusicMap(date: string) {
  const { clips, batches } = await getLibrary();
  const anyClip = clips.find((c) => c.date === date);
  const batch = (batches[date] ?? {}) as { work_dir?: string; stream_duration?: number };
  const streamDuration = anyClip?.stream_duration ?? batch.stream_duration ?? null;

  // A prepared stream records exactly where its map lives. Without this the only
  // way to find it was to match durations against an existing clip — which a
  // stream that has never been clipped does not have.
  const workDir = resolveRepoPath(batch.work_dir);
  if (workDir) {
    const music = await readJson<{
      per_second_score?: number[];
      per_second_sung?: number[];
      duration?: number;
    }>(path.join(/*turbopackIgnore: true*/ workDir, "music.json"), {});
    if (music.duration) {
      return {
        score: music.per_second_score ?? [],
        sung: music.per_second_sung ?? [],
        duration: music.duration,
      };
    }
  }

  // work dirs are named from the source filename; find the one holding this date's map
  let dirs: string[] = [];
  try {
    dirs = await readdir(FILES.work);
  } catch {
    return { score: [], sung: [], duration: streamDuration };
  }
  for (const d of dirs) {
    const music = await readJson<{
      per_second_score?: number[];
      per_second_sung?: number[];
      duration?: number;
    }>(path.join(FILES.work, d, "music.json"), {});
    if (!music.duration) continue;
    if (streamDuration && Math.abs(music.duration - streamDuration) < 2) {
      return {
        score: music.per_second_score ?? [],
        sung: music.per_second_sung ?? [],
        duration: music.duration,
      };
    }
  }
  return { score: [], sung: [], duration: streamDuration };
}

/**
 * The stream's measured layout, used as the starting framing for a clip that has
 * none of its own. A brand-new clip would otherwise open with a blank 9:16
 * preview and nothing to drag; calibration is a real measurement of where the
 * webcam and the arrangement sit in THIS stream, so it is a fair first guess.
 */
export async function getCalibration(date: string) {
  const { batches } = await getLibrary();
  const batch = (batches[date] ?? {}) as { calibration?: string; work_dir?: string };
  const calWorkDir = resolveRepoPath(batch.work_dir);
  const file =
    resolveRepoPath(batch.calibration) ??
    (calWorkDir
      ? path.join(/*turbopackIgnore: true*/ calWorkDir, "calibration.json")
      : null);
  if (!file) return null;
  const cal = await readJson<{
    frame?: { width: number; height: number };
    webcam_default?: { x: number; y: number; w: number; h: number };
    arrangement_left?: number;
    daw_top?: number;
    daw_bottom?: number;
    mode?: string;
    reason?: string;
  }>(file, {});
  if (!cal.frame) return null;

  // A camera-only stream is calibrated, not uncalibrated. It has no webcam inset
  // because the camera IS the frame, so `webcam_default` is null by design —
  // and returning null here told the dashboard the stream had never been
  // measured, which is the third place an IRL stream dead-ended after
  // calibrate.py and prepare_stream.py were fixed.
  // `[x, y, w, h]`, not `{x, y, w, h}`. Everything downstream is a tuple —
  // `rect-editor`'s `Rect`, `vertical-preview`'s `number[]`, and the `cam`/`daw`
  // arrays the library stores per clip. This function returned objects and the
  // timeline cast them with `as Rect`, which typechecked and was false.
  //
  // It never showed because the calibration fallback was unreachable: a stream
  // with clips took `clip.cam` first, and a stream without clips had no
  // calibration to fall back to. Making a camera-only stream return calibration
  // made a clip-less stream reach it for the first time, and the object hit
  // `const [, , sw, sh] = cam` and `rect.join(" ")`.
  if (cal.mode === "fullcam" || !cal.webcam_default) {
    return {
      frame: cal.frame,
      mode: "fullcam" as const,
      reason: cal.reason,
      // The camera is the whole frame when there is no inset.
      cam: [0, 0, cal.frame.width, cal.frame.height] as [number, number, number, number],
      daw: null,
    };
  }

  const w = cal.webcam_default;
  const left = cal.arrangement_left ?? 0;
  const top = cal.daw_top ?? 0;
  const bottom = cal.daw_bottom ?? cal.frame.height;
  return {
    frame: cal.frame,
    mode: "split" as const,
    reason: undefined,
    cam: [w.x, w.y, w.w, w.h] as [number, number, number, number],
    daw: [left, top, Math.max(1, cal.frame.width - left), Math.max(1, bottom - top)] as
      [number, number, number, number],
  };
}

/**
 * Which streams are ready to edit. Preparation records a work dir on the batch
 * only once every stage has succeeded, so this is a real answer rather than a
 * guess from a file existing.
 */
export async function getPreparedStreams(): Promise<Set<string>> {
  const { batches } = await getLibrary();
  const ready = new Set<string>();
  for (const [date, batch] of Object.entries(batches)) {
    if ((batch as { work_dir?: string })?.work_dir) ready.add(date);
  }
  return ready;
}

/** Audio peaks for the timeline — the actual sound, not the music score. */
export async function getWaveform(date: string) {
  return readJson<{ duration?: number; buckets?: number; peaks?: number[] }>(
    path.join(REPO, "streams", "waveform", `${date}.json`),
    {}
  );
}

export type TranscriptSegment = { start: number; end: number; text: string; edited?: boolean };

export async function getTranscript(date: string) {
  const base = await readJson<{ segments?: TranscriptSegment[]; coverage?: string }>(
    path.join(FILES.transcripts, `${date}.json`),
    {}
  );
  const edits = await readJson<{ edits?: { at: number; text: string; was?: string }[] }>(
    path.join(FILES.transcripts, `${date}.edits.json`),
    {}
  );
  const list = edits.edits ?? [];
  const segments = (base.segments ?? []).map((seg) => {
    const hit = list.find((e) => Math.abs(e.at - seg.start) <= 0.35);
    return hit ? { ...seg, text: hit.text, edited: true } : seg;
  });
  return { segments, coverage: base.coverage ?? null, edits: list };
}

export async function addTranscriptEdit(date: string, at: number, text: string) {
  const file = path.join(FILES.transcripts, `${date}.edits.json`);
  const data = await readJson<{ version?: number; edits?: { at: number; text: string }[] }>(file, {
    version: 1,
    edits: [],
  });
  const edits = (data.edits ?? []).filter((e) => Math.abs(e.at - at) > 0.35);
  edits.push({ at: Math.round(at * 100) / 100, text });
  edits.sort((a, b) => a.at - b.at);
  await writeJson(file, { version: 1, edits });
  return edits;
}

/**
 * Record a creator decision on a clip, with the history undo needs.
 * Mirrors `library.set_creator` — an automatic stage fills what is absent and
 * never overwrites what a human set.
 */
export const CREATOR_FIELDS = [
  "start",
  "end",
  "context_tag",
  "framing",
  "hook",
  "layout",
  "output_mode",
] as const;

/**
 * A clip has to stay a clip. Without these bounds "Set in here" with the playhead
 * at zero silently produced a 26-minute "clip" — the edit was recorded, the UI
 * showed it, and nothing complained. Same idea as the framing gates: a hand-set
 * value gets checked exactly like a measured one.
 */
export const MIN_CLIP_S = 5;
export const MAX_CLIP_S = 180;

function checkRange(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("in and out must be numbers");
  if (start < 0) throw new Error("in point cannot be before the start of the stream");
  if (end <= start) throw new Error("out point must come after the in point");
  const len = end - start;
  if (len < MIN_CLIP_S) throw new Error(`that would be ${len.toFixed(1)}s — clips are at least ${MIN_CLIP_S}s`);
  if (len > MAX_CLIP_S) {
    throw new Error(
      `that would be ${Math.round(len)}s — clips are at most ${MAX_CLIP_S}s. ` +
        `Seek to where you want the edge first.`
    );
  }
}

export async function setCreatorField(clipPath: string, field: string, value: unknown) {
  if (!CREATOR_FIELDS.includes(field as (typeof CREATOR_FIELDS)[number])) {
    throw new Error(`not a creator-settable field: ${field}`);
  }
  const data = await readJson<{ clips?: Record<string, Clip> }>(FILES.library, {});
  const clip = data.clips?.[clipPath];
  if (!clip) throw new Error(`unknown clip: ${clipPath}`);

  if (field === "start" || field === "end") {
    const now = resolveClip({ ...clip, path: clipPath });
    checkRange(
      field === "start" ? Number(value) : now.start,
      field === "end" ? Number(value) : now.end
    );
  }
  const creator = { ...(clip.creator ?? {}) } as Record<string, unknown>;
  const before = creator[field] ?? null;
  creator[field] = value;
  clip.creator = creator;
  clip.history = [...(clip.history ?? []), { field, from: before, to: value }].slice(-200);
  await writeJson(FILES.library, data);
  return resolveClip({ ...clip, path: clipPath });
}

export async function undoCreator(clipPath: string) {
  const data = await readJson<{ clips?: Record<string, Clip> }>(FILES.library, {});
  const clip = data.clips?.[clipPath];
  if (!clip) throw new Error(`unknown clip: ${clipPath}`);
  const history = [...(clip.history ?? [])];
  const last = history.pop();
  if (!last) return resolveClip({ ...clip, path: clipPath });
  const creator = { ...(clip.creator ?? {}) } as Record<string, unknown>;
  if (last.from === null || last.from === undefined) delete creator[last.field];
  else creator[last.field] = last.from;
  clip.creator = creator;
  clip.history = history;
  await writeJson(FILES.library, data);
  return resolveClip({ ...clip, path: clipPath });
}

export async function setClipStatus(clipPath: string, status: string) {
  const data = await readJson<{ clips?: Record<string, Clip> }>(FILES.library, {});
  const clip = data.clips?.[clipPath];
  if (!clip) throw new Error(`unknown clip: ${clipPath}`);
  clip.status = status;
  await writeJson(FILES.library, data);
  return clip;
}

/**
 * A per-stream setting on the batch — merged, never replacing.
 *
 * The batch is written by several stages and no stage knows the whole record:
 * preparation stamps `work_dir`/`source`, selection stamps its guardrails. Same
 * contract as `library.record_settings()` on the Python side; replacing it here
 * would silently un-prepare a stream.
 */
export async function setStreamField(date: string, field: string, value: unknown) {
  const data = await readJson<{ batches?: Record<string, Record<string, unknown>> }>(
    FILES.library,
    {}
  );
  data.batches = data.batches ?? {};
  const batch = (data.batches[date] = data.batches[date] ?? {});
  batch[field] = value;
  await writeJson(FILES.library, data);
  return batch;
}

export async function setClipCopy(clipPath: string, copy: Record<string, string>) {
  const data = await readJson<{ clips?: Record<string, Clip> }>(FILES.library, {});
  const clip = data.clips?.[clipPath];
  if (!clip) throw new Error(`unknown clip: ${clipPath}`);
  clip.copy = { ...(clip.copy ?? {}), ...copy };
  await writeJson(FILES.library, data);
  return clip;
}

/**
 * Create a clip from an arbitrary range, or split an existing one.
 *
 * Both write straight into the library as creator-set clips, so the renderer
 * treats them exactly like an AI pick that a human adjusted — and a pipeline
 * re-run will not remove them.
 */
export async function createClip(date: string, start: number, end: number, tag = "beat") {
  const data = await readJson<{ clips?: Record<string, Clip> }>(FILES.library, {});
  data.clips ??= {};
  checkRange(start, end);
  const stamp = [Math.floor(start / 3600), Math.floor(start / 60) % 60, Math.floor(start % 60)]
    .map((n) => String(n).padStart(2, "0"))
    .join("");
  const clipPath = `clips/${date}/${stamp}_${tag}.mp4`;
  if (data.clips[clipPath]) throw new Error("a clip already starts at that time");

  const sibling = Object.values(data.clips).find((c) => c.date === date);
  data.clips[clipPath] = {
    path: clipPath,
    date,
    start,
    end,
    duration: end - start,
    context_tag: tag,
    // No selector proposed this one — a person drew it on the timeline, which is
    // the strongest provenance a clip can have. Stamped here rather than only in
    // sync_candidates.py, because that runs at render time and the Review queue
    // shows the clip long before then: without this, the one clip whose origin
    // matters most is the one with no chip against it.
    selector: "hand",
    score: 0,
    excerpt: "",
    stream_duration: sibling?.stream_duration ?? null,
    status: "new",
    creator: { start, end, context_tag: tag },
    history: [{ field: "created", from: null, to: { start, end } }],
  } as Clip;
  await writeJson(FILES.library, data);
  return data.clips[clipPath];
}

export async function splitClip(clipPath: string, at: number) {
  const data = await readJson<{ clips?: Record<string, Clip> }>(FILES.library, {});
  const clip = data.clips?.[clipPath];
  if (!clip) throw new Error(`unknown clip: ${clipPath}`);
  const resolved = resolveClip({ ...clip, path: clipPath });
  if (at <= resolved.start + 1 || at >= resolved.end - 1) {
    throw new Error("split point must be at least a second inside the clip");
  }
  // Left half keeps the record and its copy; the right half is a new clip, so no
  // hand-written hook is silently duplicated onto a range it was not written for.
  await setCreatorField(clipPath, "end", at);
  return createClip(resolved.date ?? "", at, resolved.end, resolved.context_tag);
}

/**
 * Which file the browser should actually play for a stream.
 *
 * Not always the source: two of the first three captures were MPEG-TS with an
 * .mp4 name (they start with 0x47, not `ftyp`), which no browser plays, and an
 * MP4 whose moov index sits after the media cannot be seeked. `make_proxy.py`
 * remuxes those into `streams/proxy/<date>.mp4`; prefer it when it exists.
 */
export async function playableFor(date: string): Promise<string | null> {
  const candidates = [
    path.join(REPO, "streams", "proxy", `${date}.small.mp4`),
    path.join(REPO, "streams", "proxy", `${date}.mp4`),
  ];
  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch {
      /* try the next one */
    }
  }
  const { batches } = await getLibrary();
  const recorded = (batches[date] ?? {}) as Record<string, string>;
  // Through resolveRepoPath, not raw. Batch paths became repo-relative in the
  // portability migration and every other consumer was wired through it; this
  // one was missed, so the source came back relative and `stat` looked for it
  // under the server's cwd. It only showed on a stream with no proxy — the
  // proxy candidates above are already absolute — which is why it surfaced on
  // the two newest captures as "The element has no supported sources".
  return resolveRepoPath(recorded.source);
}

/**
 * The three cards on the timeline's left rail: what was selected, how it laid
 * out, and whether it passed QA. All of it already exists as pipeline output —
 * this just finds the work dir that produced a given stream and reads it.
 */
export async function getStreamSummary(date: string) {
  const { clips, batches } = await getLibrary();
  const mine = clips.filter((c) => c.date === date);
  const batch = (batches[date] ?? {}) as Record<string, unknown>;

  const split = mine.filter((c) => c.mode === "split").length;
  const locked = mine.filter((c) => (c.creator as { framing?: unknown })?.framing).length;
  const avg = mine.length
    ? mine.reduce((a, c) => a + (c.score ?? 0), 0) / mine.length
    : 0;

  let qa: { clips: number; passed: number; failed: number } | null = null;
  // Same trap as playableFor: `work_dir` is stored repo-relative, so joining it
  // raw looked for qa.json under the server's cwd and silently found nothing —
  // every stream reported "No QA report for this batch yet" while the file was
  // on disk.
  const workDir = resolveRepoPath(batch.work_dir as string | undefined);
  if (workDir) {
    const parsed = await readJson<{ clips?: number; passed?: number; failed?: number }>(
      path.join(workDir, "qa.json"),
      {}
    );
    if (typeof parsed.clips === "number") {
      qa = { clips: parsed.clips, passed: parsed.passed ?? 0, failed: parsed.failed ?? 0 };
    }
  }

  return {
    count: mine.length,
    avgScore: Math.round(avg * 10) / 10,
    split,
    reframe: mine.length - split,
    locked,
    qa,
    settings: {
      mirror: Boolean(batch.mirror),
      asked: batch.asked ?? batch.count ?? null,
      selected: batch.selected ?? mine.length,
      limitedBy: batch.limited_by ?? null,
      spacing: batch.spacing ?? null,
      sungWeight: batch.sung_weight ?? null,
    },
  };
}

/** Remove a clip from the library. The rendered file, if any, is left alone. */
export async function deleteClip(clipPath: string) {
  const data = await readJson<{ clips?: Record<string, Clip> }>(FILES.library, {});
  if (!data.clips?.[clipPath]) throw new Error(`unknown clip: ${clipPath}`);
  delete data.clips[clipPath];
  await writeJson(FILES.library, data);
  return { deleted: clipPath };
}

export async function getLocks() {
  return readJson<{ locks?: unknown[] }>(FILES.locks, { locks: [] });
}

export async function addLock(lock: Record<string, unknown>) {
  const data = await readJson<{ version?: number; locks?: unknown[] }>(FILES.locks, {
    version: 1,
    locks: [],
  });
  data.locks = [...(data.locks ?? []), lock];
  await writeJson(FILES.locks, data);
  return data;
}

export async function getSettings() {
  return readJson<{ defaults?: Record<string, unknown>; streams?: Record<string, unknown> }>(
    FILES.settings,
    {}
  );
}

/** Regions each platform draws its own UI over. Mirrors `safe_areas.py`. */
export const PLATFORM_SAFE = {
  tiktok: { bottom: 0.167, right: 0.13, top: 0.057 },
  reels: { bottom: 0.182, right: 0.093, top: 0.052 },
  shorts: { bottom: 0.12, right: 0.093, top: 0.047 },
} as const;

export function coveredBy(box: { x: number; y: number; w: number; h: number }, w: number, h: number) {
  return Object.entries(PLATFORM_SAFE)
    .filter(([, p]) => box.y + box.h > h * (1 - p.bottom) || box.x + box.w > w * (1 - p.right) || box.y < h * p.top)
    .map(([name]) => name);
}
