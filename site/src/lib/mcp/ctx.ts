// Shared context for the YP Digital MCP tools.
//
// The dashboard already owns every action this connector exposes: /api/yp/*
// routes start the same detached jobs and write the same state files whether
// the click came from a browser or an agent. So action tools here do NOT
// re-spawn anything — they call those routes over this app's own HTTP surface
// (fetchInternal) and pass the JSON through. One implementation, two front
// doors, and an agent can never drift from what the dashboard would do.

import path from "node:path";

export const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
export const PIPELINE = path.join(/*turbopackIgnore: true*/ REPO, "tools", "clip-pipeline");

/** A tool failure the JSON-RPC layer renders as a proper tool error. */
export class ToolError extends Error {
  outcome: "error" | "denied";
  data?: Record<string, unknown>;
  constructor(message: string, opts: { outcome?: "error" | "denied"; data?: Record<string, unknown> } = {}) {
    super(message);
    this.outcome = opts.outcome ?? "error";
    this.data = opts.data;
  }
}

export type McpContext = {
  /** This app's own origin (http://localhost:3000 locally), for internal route calls. */
  origin: string;
  /** Call one of the dashboard's own /api/yp routes and return its response. */
  fetchInternal: (pathname: string, init?: RequestInit) => Promise<Response>;
};

const STREAM_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Streams are addressed everywhere by their capture date. Enforce it once. */
export function requireStreamDate(value: unknown): string {
  const stream = String(value ?? "");
  if (!STREAM_DATE.test(stream)) {
    throw new ToolError(`expected a stream date (YYYY-MM-DD), got ${JSON.stringify(value)}`);
  }
  return stream;
}

/** A repo-relative clip path, refused if it tries to leave clips/. */
export function requireClipPath(value: unknown): string {
  const clip = String(value ?? "");
  const abs = path.resolve(REPO, clip);
  if (!abs.startsWith(path.join(REPO, "clips") + path.sep)) {
    throw new ToolError("clip path must be a repo-relative path inside clips/");
  }
  return clip;
}
