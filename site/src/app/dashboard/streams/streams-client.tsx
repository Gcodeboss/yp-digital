"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip } from "../yp-chrome";

/**
 * The two things this screen could not do: take a stream in, and find the clips
 * in one.
 *
 * Both were terminal commands, and the screen's own copy said so — "open one to
 * start clipping" led to a timeline with nothing on it. What is here is the
 * smallest pair of controls that closes that: paste a link or a path, and on a
 * stream that is ready but empty, ask for candidates.
 *
 * Rule 2 governs the colour. Amber is "now" and nothing else, so it marks the
 * job that is running and the action that is waiting to be taken. Mint is
 * system-OK and appears only as a dot. Sienna carries every failure. Nothing
 * else on this screen is coloured, and no state is expressed by a spinner alone:
 * a job that fails says what failed, in words, with the tool's own output under
 * it.
 */

type Job = {
  job: string;
  mode: "url" | "file";
  input: string;
  step: string;
  running: boolean;
  done: boolean;
  error: string | null;
  started_at: number;
  updated_at?: number;
  stream?: string;
  title?: string;
  note?: string | null;
  log?: string;
};

const MICRO = "font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim";
const NUM = "font-mono text-xs tabular-nums text-ink-dim";

function elapsed(job: Job) {
  const end = job.running ? Date.now() / 1000 : (job.updated_at ?? job.started_at);
  const s = Math.max(0, Math.round(end - job.started_at));
  const parts = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
  return (parts[0] ? parts : parts.slice(1)).map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Take a stream in.
 *
 * One field for both kinds of source. The route decides which it is by whether
 * there is a scheme, so a mistyped link is answered as a bad link rather than as
 * a missing file — and either answer arrives as a sentence, not a status code.
 *
 * A download is gigabytes and runs detached, so this polls the job rather than
 * holding a request open, and it renders the running jobs it finds on mount:
 * reloading the page during a two-hour transfer should not lose the transfer.
 */
export function AddStream() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settled = useRef<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/yp/ingest", { cache: "no-store" });
      const data = (await res.json()) as { jobs?: Job[] };
      const next = data.jobs ?? [];
      setJobs(next);
      // A finished ingest changes what the server rendered underneath us.
      const fresh = next.filter((j) => !j.running && !settled.current.has(j.job));
      next.forEach((j) => !j.running && settled.current.add(j.job));
      if (fresh.some((j) => j.done)) router.refresh();
      return next.some((j) => j.running);
    } catch {
      /* the dash is local; a dropped poll is not worth a message */
      return false;
    }
  }, [router]);

  /**
   * Watch the jobs on disk.
   *
   * One effect, and every state write happens from a timer callback rather than
   * from the effect body — the effect subscribes to an external system (the job
   * files an ingest writes) instead of reading it once while rendering. The
   * first read is scheduled rather than called, so the list still fills straight
   * away without a synchronous setState during the effect.
   *
   * Three seconds while something is working; every twenty otherwise, because a
   * download can just as easily have been started from the CLI or another tab.
   */
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const working = await poll();
      if (!alive) return;
      timer = setTimeout(() => void tick(), working ? 3000 : 20000);
    };
    timer = setTimeout(() => void tick(), 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [poll]);

  async function submit() {
    const source = value.trim();
    if (!source || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/yp/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = (await res.json()) as { started?: boolean; error?: string };
      if (!res.ok || !data.started) {
        setError(data.error ?? `the ingest route answered ${res.status}`);
      } else {
        setValue("");
        await poll();
      }
    } catch (err) {
      setError(`could not reach the ingest route: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          spellCheck={false}
          placeholder="https://kick.com/video/<uuid>   or   streams/2026-08-12_session.mp4"
          aria-label="Kick VOD URL or local file path"
          className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-ground px-2 font-mono text-[11.5px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-amber/60"
        />
        <Button variant="primary" onClick={() => void submit()} disabled={busy || !value.trim()}>
          {busy ? "starting" : "Add stream"}
        </Button>
      </div>

      {error ? (
        <p className="border-t border-line px-3 py-2 text-[12px] leading-relaxed text-sienna">
          {error}
        </p>
      ) : null}

      {jobs.map((job) => (
        <div key={job.job} className="border-t border-line">
          <div className="flex items-center gap-2.5 px-3 py-2">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                job.error ? "bg-sienna" : job.running ? "bg-amber" : "bg-mint"
              }`}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
              {job.stream ? `${job.stream} · ` : ""}
              {job.title ?? job.input}
            </span>
            <span className={MICRO}>{job.error ? "failed" : job.step}</span>
            <span className={`w-[52px] shrink-0 text-right ${NUM}`}>{elapsed(job)}</span>
            <div className="w-[64px] shrink-0 text-right">
              <Chip tone={job.error ? "rust" : job.running ? "amber" : "muted"}>
                {job.error ? "error" : job.running ? "working" : "archived"}
              </Chip>
            </div>
            {/* A finished job stayed on the list forever. Retrying a bad link
                three times left three identical failures and no way to clear
                them, so the newest real state was the hardest thing to see. */}
            {!job.running ? (
              <button
                title="clear this job"
                onClick={async () => {
                  await fetch(`/api/yp/ingest?job=${encodeURIComponent(job.job)}`, {
                    method: "DELETE",
                  });
                  await poll();
                }}
                className="w-4 shrink-0 text-center font-mono text-[13px] leading-none text-ink-faint hover:text-sienna"
              >
                ×
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
          </div>
          {job.error ? (
            <div className="border-t border-line bg-ground/60 px-3 py-2">
              <p className="text-[12px] leading-relaxed text-sienna">{job.error}</p>
              {job.log ? (
                <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-dim">
                  {job.log}
                </pre>
              ) : null}
            </div>
          ) : null}
          {job.note ? (
            <p className="border-t border-line px-3 py-1.5 text-[11.5px] text-ink-dim">{job.note}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * One archived stream.
 *
 * A client component rather than the link the page used to render, for one
 * reason: an action cannot live inside an anchor. The row is the link; the
 * action sits beside it and owns the strip underneath, which is where a failed
 * selection puts its sentence. A message that has nowhere to go is a message
 * that gets replaced by a spinner.
 */

/**
 * Archive an at-risk stream without anyone retyping a URL.
 *
 * The one action in this tool with a deadline on it was the one with no button.
 * The screen already showed "2026-08-25 · 17d left" while `archive.json` held
 * that stream's uuid and its HLS URL from the last scan — and still asked the
 * operator to paste a link copied from kick.com. Pasting a VOD id that does not
 * exist is exactly how that goes wrong, and it did: a hand-entered id returned
 * 404 while the real one downloaded fine.
 *
 * Prefers the scanned HLS URL over the page URL, because the page URL sends
 * yt-dlp back through `kick.com/api` — the endpoint Cloudflare blocks.
 */
export function ArchiveNow({
  uuid,
  hls,
  slug,
}: {
  uuid: string;
  hls?: string;
  slug?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = hls || `https://kick.com/yanchanproduced/videos/${uuid}`;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {error && (
        <span className="max-w-[280px] truncate text-[11px] text-sienna" title={error}>
          {error}
        </span>
      )}
      <button
        disabled={busy}
        title={
          hls
            ? "Download it now, using the stream URL the last scan found"
            : "Download it now"
        }
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/yp/ingest", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ source, uuid, slug }),
            });
            const data = (await res.json()) as { started?: boolean; error?: string };
            if (!res.ok || !data.started) {
              setError(data.error ?? `the ingest route answered ${res.status}`);
            } else {
              router.refresh();
            }
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className="border border-amber bg-amber px-2.5 py-1 font-head text-[10px] font-semibold uppercase tracking-[0.08em] text-ground transition-colors hover:border-gold hover:bg-gold disabled:opacity-40"
      >
        {busy ? "Starting…" : "Archive now"}
      </button>
    </div>
  );
}

export function StreamRow({
  href,
  title,
  date,
  hours,
  gb,
  clips,
  ready,
  partialNote,
}: {
  href: string;
  title: string;
  date: string;
  hours: string;
  gb: string;
  clips: number;
  ready: boolean;
  /** Set when the capture is real but short — see status "partial". */
  partialNote?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function find() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/yp/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: date, count: 10 }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        selected?: number;
        note?: string | null;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `the select route answered ${res.status}`);
      } else {
        setNote(data.note ?? `selected ${data.selected}`);
        router.refresh();
      }
    } catch (err) {
      setError(`could not reach the select route: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.03]">
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-4">
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{title}</span>
          <span className={`w-[92px] shrink-0 ${NUM}`}>{date}</span>
          <span className={`w-[64px] shrink-0 text-right ${NUM}`}>{hours}</span>
          <span className={`w-[72px] shrink-0 text-right ${NUM}`}>{gb} GB</span>
          <span className={`w-[64px] shrink-0 text-right ${NUM}`}>
            {clips > 0 ? `${clips} clips` : "—"}
          </span>
        </Link>
        <div className="w-[104px] shrink-0 text-right">
          {partialNote && (
            <span title={partialNote}>
              <Chip tone="rust">partial</Chip>
            </span>
          )}
          <Chip tone={ready ? "amber" : "muted"}>{ready ? "ready" : "not prepared"}</Chip>
        </div>
        <div className="flex w-[92px] shrink-0 justify-end">
          {ready && clips === 0 ? (
            <Button size="sm" onClick={() => void find()} disabled={busy}>
              {busy ? "finding" : "Find clips"}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="px-4 pb-2.5 text-[12px] leading-relaxed text-sienna">{error}</p>
      ) : null}
      {note && !error ? (
        <p className="px-4 pb-2.5 text-[12px] leading-relaxed text-ink-dim">{note}</p>
      ) : null}
    </div>
  );
}
