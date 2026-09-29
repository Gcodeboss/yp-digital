// YP Digital local MCP server, for AI agents such as Muse.
//
// Design D2 from the IronClad muse-mcp-connector, adapted for a locally hosted
// app: Streamable-HTTP transport, stateless — every POST carries one JSON-RPC
// message (or a batch) and gets application/json back. No SSE, no sessions, so
// GET/DELETE are 405 as the spec allows. Auth is a shared bearer token
// (YP_MCP_TOKEN): the app only ever runs on localhost behind the
// OPS_DASHBOARD gate, so a full OAuth server would be machinery with nobody to
// protect. If the token is unset the endpoint is open — same trust level as
// the dashboard itself. Tools live in src/lib/mcp/* and act through the
// dashboard's own /api/yp routes, so an agent can never do something the UI
// could not.

import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { TOOL_BY_NAME, describe } from "@/lib/mcp/tools";
import { ToolError } from "@/lib/mcp/ctx";
import type { McpContext } from "@/lib/mcp/ctx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST = "2025-06-18";

const SERVER_INFO = { name: "yp-digital", title: "YP Digital Clip System", version: "1.0.0" };

const INSTRUCTIONS =
  "Yanchan Produced's Kick-to-clips system, running on the operator's local Mac. You act with the same " +
  "powers as the dashboard: archive streams from Kick, prepare them, select candidate moments, render " +
  "finished vertical clips, and review the library. Streams are addressed by capture date (YYYY-MM-DD). " +
  "The pipeline order is archive → prepare → select → render; each step refuses politely when the one " +
  "before it has not happened. Downloads and renders are long — they run as background jobs, so always " +
  "note the job reference from an action's response and poll job_status until it finishes; never claim a " +
  "clip exists before job_status says it rendered. Kick deletes VODs after ~30 days: when list_streams " +
  "shows atRisk streams, archive the most urgent first. The clip score measures music and vocal strength — " +
  "it ranks moments within one stream and says nothing about virality. Writes (archive, prepare, select, " +
  "render, set_clip_status, set_clip_copy) change real files on this machine; read before you write, and " +
  "confirm destructive or hard-to-reverse actions with the user first.";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version, www-authenticate",
  "access-control-max-age": "86400",
};

const TOKEN = process.env.YP_MCP_TOKEN ?? "";

const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new NextResponse(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

function originOf(req: Request): string {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || u.host;
  const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function ctxFor(req: Request): McpContext {
  const origin = originOf(req);
  return {
    origin,
    fetchInternal: (pathname, init) => fetch(`${origin}${pathname}`, init),
  };
}

// Token auth, deliberately simple: a shared secret configured on this Mac.
// Muse sends it as `Authorization: Bearer <token>` on every call. When no
// token is configured the endpoint trusts localhost, exactly like the
// dashboard it fronts.
function authorized(req: Request): { ok: true } | { ok: false; message: string; invalidToken?: boolean } {
  if (!TOKEN) return { ok: true };
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return { ok: false, message: "missing bearer token" };
  if (match[1] !== TOKEN) return { ok: false, message: "invalid bearer token", invalidToken: true };
  return { ok: true };
}

type CallToolResult = { rpcError: [number, string] } | { result: unknown };

async function callTool(ctx: McpContext, params: { name?: string; arguments?: unknown }): Promise<CallToolResult> {
  const name = params?.name;
  const args = (params?.arguments ?? {}) as Record<string, unknown>;
  const tool = name ? TOOL_BY_NAME.get(String(name)) : undefined;
  if (!tool) return { rpcError: [-32602, `Unknown tool: ${String(name)}`] };

  let result;
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    result = { isError: true, content: [{ type: "text", text: "arguments must be an object" }] };
  } else {
    try {
      const value = await tool.run(ctx, args);
      const structured = value && typeof value === "object" && !Array.isArray(value) ? value : { result: value };
      result = {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        structuredContent: structured,
      };
    } catch (err) {
      const te = err instanceof ToolError ? err : null;
      const message = te ? te.message : `Internal error in ${String(name)}: ${err instanceof Error ? err.message : String(err)}`;
      if (!te) console.error("mcp tool crashed", name, err);
      const content = [{ type: "text", text: message }];
      let structured;
      if (te && te.data) {
        content.push({ type: "text", text: JSON.stringify(te.data, null, 2) });
        structured = { error: message, outcome: te.outcome, ...te.data };
      }
      result = { isError: true, content, ...(structured ? { structuredContent: structured } : {}) };
    }
  }
  return { result };
}

async function handleMessage(ctx: McpContext, msg: Record<string, unknown>) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    // A response or garbage: responses from the client need no reply.
    if (msg && (msg.result !== undefined || msg.error !== undefined)) return null;
    return rpcError(msg?.id, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const { method, params, id } = msg as { method: string; params?: any; id?: unknown };

  if (isNotification) return null; // notifications/initialized, cancelled, etc.

  switch (method) {
    case "initialize": {
      const asked = params && params.protocolVersion;
      const protocolVersion = SUPPORTED_VERSIONS.includes(asked) ? asked : LATEST;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: [...TOOL_BY_NAME.values()].map(describe) });
    case "tools/call": {
      const r = await callTool(ctx, params ?? {});
      if ("rpcError" in r) return rpcError(id, r.rpcError[0], r.rpcError[1]);
      return rpcResult(id, r.result);
    }
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });

  // Clients such as Muse probe with a bare GET and expect the 401 challenge
  // before sign-in; answering 405 first makes them give up. Authenticated GET
  // still gets 405 — this server only accepts POST (no SSE stream).
  const auth = authorized(req);
  if (!auth.ok) {
    const extra: Record<string, string> = {
      "www-authenticate": `Bearer realm="yp-digital"${auth.invalidToken ? `, error="invalid_token", error_description="${auth.message}"` : ""}`,
    };
    return json(rpcError(null, -32001, auth.message), 401, extra);
  }
  return json(
    rpcError(null, -32000, "Method not allowed: this server only accepts POST (no SSE stream)"),
    405,
    { allow: "POST, OPTIONS" }
  );
}

export async function POST(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });

  const auth = authorized(req);
  if (!auth.ok) {
    const extra: Record<string, string> = {};
    if (!auth.ok) {
      extra["www-authenticate"] = `Bearer realm="yp-digital"${auth.invalidToken ? `, error="invalid_token", error_description="${auth.message}"` : ""}`;
    }
    return json(rpcError(null, -32001, auth.message), 401, extra);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error: body must be JSON-RPC"), 400);
  }

  const ctx = ctxFor(req);

  if (Array.isArray(body)) {
    if (!body.length) return json(rpcError(null, -32600, "Invalid Request: empty batch"), 400);
    const out: unknown[] = [];
    for (const m of body) {
      const r = await handleMessage(ctx, m);
      if (r) out.push(r);
    }
    return out.length ? json(out) : new NextResponse(null, { status: 202, headers: CORS });
  }

  const r = await handleMessage(ctx, body as Record<string, unknown>);
  if (!r) return new NextResponse(null, { status: 202, headers: CORS });
  return json(r, 200, {
    "mcp-protocol-version":
      ((body as Record<string, unknown>).method === "initialize" &&
        (r as { result?: { protocolVersion?: string } }).result?.protocolVersion) ||
      req.headers.get("mcp-protocol-version") ||
      LATEST,
  });
}
