import { NextResponse } from "next/server";
import { bearer, verifyAgentKey } from "./keys";
import { toolsFor } from "./mcp";

/** Runs one agent tool for the REST door (/api/tools), with the same key scopes as MCP. */
export async function runRestTool(req: Request, name: string, args: unknown) {
  const key = await verifyAgentKey(bearer(req));
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tool = toolsFor(key).find((t) => t.name === name);
  if (!tool) return NextResponse.json({ error: `Unknown tool or not allowed for this key: ${name}` }, { status: 404 });
  try {
    const result = await tool.run(args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {}, key);
    const failed = result && typeof result === "object" && "error" in result;
    return NextResponse.json(result ?? null, { status: failed ? 400 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
