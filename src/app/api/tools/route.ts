import { NextResponse } from "next/server";
import { bearer, verifyAgentKey } from "@/lib/hub/keys";
import { toolsFor } from "@/lib/hub/mcp";
import { runRestTool } from "@/lib/hub/rest";

/**
 * Plain REST door to every agent tool the MCP server offers, for anything that
 * can't speak MCP (ChatGPT actions, Meta Muse, Hermes scripts, Zapier).
 *
 *   GET  /api/tools                      → the tools this key may use, with input schemas
 *   POST /api/tools/{name}  {…arguments} → run one (e.g. create_deal, create_funnel, update_file)
 *   POST /api/tools  { tool, arguments } → same, for clients that can't vary the path
 */
export async function GET(req: Request) {
  const key = await verifyAgentKey(bearer(req));
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    tools: toolsFor(key).map((t) => ({ name: t.name, description: t.description, scope: t.scope, inputSchema: t.inputSchema })),
  });
}

export async function POST(req: Request) {
  let body: { tool?: unknown; arguments?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON: { tool, arguments }." }, { status: 400 });
  }
  return runRestTool(req, String(body.tool ?? ""), body.arguments);
}
