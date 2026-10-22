import { mcpHttp } from "@/lib/hub/mcp";
import { bearer } from "@/lib/hub/keys";

export const maxDuration = 300;

/** MCP endpoint for agents that can send an Authorization: Bearer header (Hermes, ChatGPT, Claude Code). */
const handle = (req: Request) => mcpHttp(req, bearer(req));

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
