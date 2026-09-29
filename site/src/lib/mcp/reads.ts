// Read-only MCP tools. These read the same files the dashboard renders from
// (@/lib/yp), so an agent's answer and the screen behind it cannot disagree.

import { getStreams, getLibrary, getClipsForStream, getStreamSummary, getPreparedStreams } from "@/lib/yp";
import { requireStreamDate, ToolError } from "./ctx";

export default [
  {
    name: "overview",
    description:
      "The state of the whole system in one call: how many streams are archived / at risk on Kick / unrecoverable, " +
      "when the last Kick scan ran (and whether it is stale), and how many clips exist by review status. " +
      "Start here before anything else.",
    inputSchema: { type: "object", properties: {} },
    write: false,
    async run() {
      const [streams, library] = await Promise.all([getStreams(), getLibrary()]);
      const counts = (status: string) => library.clips.filter((c) => (c.status ?? "new") === status).length;
      return {
        streams: {
          archived: streams.archived.length,
          // null, not 0, when the scan is too old to know — the same rule the
          // Streams screen follows.
          atRisk: streams.scan.state === "stale" ? null : streams.atRisk.length,
          unrecoverable: streams.unrecoverable.length,
          mostUrgent: streams.scan.state === "stale" ? null : (streams.atRisk[0] ?? null),
          scan: streams.scan,
        },
        clips: {
          total: library.clips.length,
          approved: library.clips.filter((c) => c.status === "approved").length,
          pending: counts("new"),
          byStatus: Object.fromEntries(
            [...new Set(library.clips.map((c) => c.status ?? "new"))].map((s) => [s, counts(s)])
          ),
        },
      };
    },
  },
  {
    name: "list_streams",
    description:
      "Every stream the archive knows about, in three buckets: archived (safe on disk, with hours and size), " +
      "atRisk (still on Kick, days until deletion — most urgent first), and unrecoverable. " +
      "Also the last Kick scan's state. Kick deletes VODs after ~30 days: archive atRisk streams first.",
    inputSchema: { type: "object", properties: {} },
    write: false,
    async run() {
      return await getStreams();
    },
  },
  {
    name: "list_clips",
    description:
      "Clips from the library (the store of record). Filter by stream date and/or review status. " +
      "Each clip carries its in/out points, duration, tag, score, layout mode and any hook/caption copy. " +
      "Paths are repo-relative — pass one to the other clip tools.",
    inputSchema: {
      type: "object",
      properties: {
        stream: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "only clips from this stream date" },
        status: { type: "string", description: "only clips with this review status (new, approved, rejected, …)" },
      },
    },
    write: false,
    async run(_ctx: unknown, a: { stream?: string; status?: string }) {
      let clips = (await getLibrary()).clips;
      if (a.stream) clips = clips.filter((c) => c.date === requireStreamDate(a.stream));
      if (a.status) clips = clips.filter((c) => (c.status ?? "new") === a.status);
      return {
        count: clips.length,
        clips: clips.map((c) => ({
          path: c.path,
          date: c.date,
          start: c.start,
          end: c.end,
          duration: c.duration,
          tag: c.context_tag,
          selector: c.selector,
          score: c.score,
          mode: c.mode,
          status: c.status ?? "new",
          copy: c.copy ?? {},
        })),
      };
    },
  },
  {
    name: "stream_state",
    description:
      "One stream's position in the pipeline: whether it is prepared (audio extracted, layout calibrated, music map done), " +
      "its summary, and the clips already cut from it. Use before prepare_stream / select_candidates to see what is missing.",
    inputSchema: {
      type: "object",
      properties: { stream: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
      required: ["stream"],
    },
    write: false,
    async run(_ctx: unknown, a: { stream: string }) {
      const stream = requireStreamDate(a.stream);
      const [prepared, summary, clips] = await Promise.all([
        getPreparedStreams(),
        getStreamSummary(stream).catch(() => null),
        getClipsForStream(stream),
      ]);
      if (!summary) throw new ToolError(`no summary for ${stream} — is it archived?`);
      return { stream, prepared: prepared.has(stream), summary, clipCount: clips.length };
    },
  },
];
