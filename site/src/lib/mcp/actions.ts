// Action MCP tools. Every one of these is the dashboard's own /api/yp route
// called over the app's local HTTP surface — the same validation, the same
// detached jobs, the same state files on disk. Long work (archive, prepare,
// render) is asynchronous: the tool returns immediately with a job reference,
// and job_status reports where it is. Nothing here blocks for minutes.

import { requireStreamDate, requireClipPath, ToolError } from "./ctx";
import type { McpContext } from "./ctx";

async function post(ctx: McpContext, pathname: string, body: Record<string, unknown>) {
  const res = await ctx.fetchInternal(pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ToolError(String(data.error ?? `${pathname} answered ${res.status}`), {
      data: { status: res.status },
    });
  }
  return data;
}

async function get(ctx: McpContext, pathname: string) {
  const res = await ctx.fetchInternal(pathname);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ToolError(String(data.error ?? `${pathname} answered ${res.status}`), {
      data: { status: res.status },
    });
  }
  return data;
}

const JOB_HINT =
  "The work runs in the background — note the job reference and poll job_status. " +
  "job_status kind mapping: archive → job=<id>, prepare/render → stream=<date>.";

export default [
  {
    name: "archive_stream",
    description:
      "Download a Kick VOD onto disk and record it in the archive — the same action as the dashboard's " +
      "\"Archive now\" button. Pass a Kick video URL, or a uuid (and slug) from list_streams' atRisk list. " +
      JOB_HINT,
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Kick video URL, or a local file path" },
        uuid: { type: "string", description: "Kick video uuid (from list_streams)" },
        slug: { type: "string", description: "stream slug/title" },
      },
    },
    write: true,
    async run(ctx: McpContext, a: { source?: string; uuid?: string; slug?: string }) {
      const source = String(a.source ?? "");
      if (!source) throw new ToolError("pass the Kick video URL (or a file path) as source");
      const data = await post(ctx, "/api/yp/ingest", {
        source,
        ...(a.uuid ? { uuid: String(a.uuid) } : {}),
        ...(a.slug ? { slug: String(a.slug) } : {}),
      });
      return { started: data.started, job: data.job, poll: { kind: "archive", job: data.job } };
    },
  },
  {
    name: "job_status",
    description:
      "Where a background job is. kind=archive takes job=<id> (from archive_stream); " +
      "kind=prepare and kind=render take stream=<YYYY-MM-DD>. " +
      "For render, progress counts finished clips; for ingest, the state file carries phase, error and log.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["archive", "prepare", "render"] },
        job: { type: "string", description: "ingest job id (kind=archive)" },
        stream: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "stream date (prepare/render)" },
      },
      required: ["kind"],
    },
    write: false,
    async run(ctx: McpContext, a: { kind: string; job?: string; stream?: string }) {
      switch (a.kind) {
        case "archive":
          if (!a.job) throw new ToolError("kind=archive needs job=<ingest job id>");
          return await get(ctx, `/api/yp/ingest?job=${encodeURIComponent(String(a.job))}`);
        case "prepare":
          return await get(ctx, `/api/yp/prepare?stream=${encodeURIComponent(requireStreamDate(a.stream))}`);
        case "render":
          return await get(ctx, `/api/yp/render?stream=${encodeURIComponent(requireStreamDate(a.stream))}`);
        default:
          throw new ToolError(`unknown kind ${JSON.stringify(a.kind)} — archive | prepare | render`);
      }
    },
  },
  {
    name: "prepare_stream",
    description:
      "Run the expensive up-front analysis on an archived stream: extract audio, calibrate the layout, " +
      "map where the music is. Minutes, in the background. Add transcribe:true to also transcribe the " +
      "candidate windows. Required before select_candidates.",
    inputSchema: {
      type: "object",
      properties: {
        stream: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        transcribe: { type: "boolean", description: "also transcribe candidate windows" },
      },
      required: ["stream"],
    },
    write: true,
    async run(ctx: McpContext, a: { stream: string; transcribe?: boolean }) {
      const stream = requireStreamDate(a.stream);
      const data = await post(ctx, "/api/yp/prepare", { stream, ...(a.transcribe ? { transcribe: true } : {}) });
      return { ...data, poll: { kind: "prepare", stream } };
    },
  },
  {
    name: "select_candidates",
    description:
      "Pick the best moments from a prepared stream's music map — the ranking blends music strength with " +
      "sustained vocal presence. Synchronous (seconds). Then render_clips turns them into finished MP4s.",
    inputSchema: {
      type: "object",
      properties: {
        stream: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        count: { type: "integer", minimum: 1, maximum: 30, default: 10 },
        layout: { type: "string", enum: ["any", "split"], description: "split = webcam-over-Ableton two-pane only" },
        kind: { type: "string", enum: ["any", "singing", "instrumental"] },
      },
      required: ["stream"],
    },
    write: true,
    async run(ctx: McpContext, a: { stream: string; count?: number; layout?: string; kind?: string }) {
      const stream = requireStreamDate(a.stream);
      const body: Record<string, unknown> = { stream };
      if (a.count !== undefined) body.count = a.count;
      if (a.layout !== undefined) body.layout = a.layout;
      if (a.kind !== undefined) body.kind = a.kind;
      return await post(ctx, "/api/yp/select", body);
    },
  },
  {
    name: "render_clips",
    description:
      "Render finished vertical clips (1080x1920, captioned, watermarked, loudness-normalised) for a stream — " +
      "the whole batch, or one clip by path. Refuses to queue if a render for this stream is already running; " +
      "poll job_status kind=render for progress. " + JOB_HINT,
    inputSchema: {
      type: "object",
      properties: {
        stream: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        clip: { type: "string", description: "repo-relative clips/ path to render just one" },
        force: { type: "boolean", description: "re-render clips already on disk" },
      },
      required: ["stream"],
    },
    write: true,
    async run(ctx: McpContext, a: { stream: string; clip?: string; force?: boolean }) {
      const stream = requireStreamDate(a.stream);
      const body: Record<string, unknown> = { stream };
      if (a.clip) body.clip = requireClipPath(a.clip);
      if (a.force) body.force = true;
      const data = await post(ctx, "/api/yp/render", body);
      return { ...data, poll: { kind: "render", stream } };
    },
  },
  {
    name: "set_clip_status",
    description:
      "Set a clip's review status (e.g. new → approved → posted, or rejected). Write it on the clip in the " +
      "library — the store of record both the dashboard and list_clips read.",
    inputSchema: {
      type: "object",
      properties: {
        clip: { type: "string", description: "repo-relative clips/ path from list_clips" },
        status: { type: "string", description: "new | approved | rejected | posted | …" },
      },
      required: ["clip", "status"],
    },
    write: true,
    async run(ctx: McpContext, a: { clip: string; status: string }) {
      return await post(ctx, "/api/yp", {
        action: "set-status",
        clip: requireClipPath(a.clip),
        status: String(a.status),
      });
    },
  },
  {
    name: "set_clip_copy",
    description:
      "Write a clip's post copy into the library: hook (first line), hook_alt (alternative), caption. " +
      "What set_copy.py and the editor screen both write — one store, read by export packs.",
    inputSchema: {
      type: "object",
      properties: {
        clip: { type: "string", description: "repo-relative clips/ path from list_clips" },
        hook: { type: "string" },
        hook_alt: { type: "string" },
        caption: { type: "string" },
      },
      required: ["clip"],
    },
    write: true,
    async run(ctx: McpContext, a: { clip: string; hook?: string; hook_alt?: string; caption?: string }) {
      const copy: Record<string, string> = {};
      if (a.hook !== undefined) copy.hook = String(a.hook);
      if (a.hook_alt !== undefined) copy.hook_alt = String(a.hook_alt);
      if (a.caption !== undefined) copy.caption = String(a.caption);
      if (!Object.keys(copy).length) throw new ToolError("pass at least one of hook, hook_alt, caption");
      return await post(ctx, "/api/yp", { action: "set-copy", clip: requireClipPath(a.clip), copy });
    },
  },
];
