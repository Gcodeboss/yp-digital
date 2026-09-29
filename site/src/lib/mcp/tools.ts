// The tool catalogue: every module's tools in one list, names checked unique.
// Same registry shape as the IronClad DMS connector this design mirrors.

import type { McpContext } from "./ctx";
import reads from "./reads";
import actions from "./actions";

/** Method shorthand keeps run's parameter types bivariant, so each tool can
 * declare its own narrow args shape while the registry holds one type. */
export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write: boolean;
  run(ctx: McpContext, args: Record<string, unknown>): Promise<unknown>;
};

export const MODULES = { reads, actions };

export const TOOLS: McpTool[] = Object.values(MODULES).flat();

export const TOOL_BY_NAME = new Map<string, McpTool>();
for (const t of TOOLS) {
  if (TOOL_BY_NAME.has(t.name)) throw new Error(`duplicate MCP tool name ${t.name}`);
  TOOL_BY_NAME.set(t.name, t);
}

export function describe(t: McpTool) {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      readOnlyHint: !t.write,
      destructiveHint: false,
      idempotentHint: !t.write,
      openWorldHint: false,
    },
  };
}
