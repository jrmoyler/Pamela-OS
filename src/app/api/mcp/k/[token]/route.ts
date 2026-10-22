import { mcpHttp } from "@/lib/hub/mcp";

export const maxDuration = 300;

/** Same MCP endpoint with the key in the URL, for connector screens that only take a URL (claude.ai, ChatGPT). */
async function handle(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return mcpHttp(req, token);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
