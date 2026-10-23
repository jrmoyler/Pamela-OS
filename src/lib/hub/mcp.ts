import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { BRAND } from "../brand";
import { RJ_TOOLS, runTool } from "../rj/tools";
import { findOrCreateContact } from "../crm";
import { isTextFile, readFile } from "../storage";
import { signedMediaUrl } from "../outbound";
import { CLIENT_LABELS, hasScope, type AgentClient, type AgentKey, type Scope } from "./keys";
import { addInboxItem, pushFile } from "./inbox";
import { claimNextComputerTask, createComputerTask, finishComputerTask, COMPUTER_RULES, type ComputerKind } from "./computer";

/**
 * Pamela OS as an MCP server (Streamable HTTP, JSON responses). Claude, ChatGPT,
 * Meta Muse and Hermes connect with an agent key from the Command Center and
 * can push files and notes in, read her data, and queue work. Anything that
 * would reach another person is still only drafted into Approvals.
 */

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: Scope;
  run: (args: Record<string, unknown>, key: AgentKey) => Promise<unknown>;
};

const str = (v: unknown) => (v == null ? "" : String(v));
const sourceOf = (key: AgentKey) => key.client as AgentClient;

async function contactIdFrom(args: Record<string, unknown>) {
  if (args.contactId && /^[0-9a-f-]{36}$/i.test(str(args.contactId))) return str(args.contactId);
  if (args.contactEmail || args.contactPhone) {
    const { contact } = await findOrCreateContact({ email: str(args.contactEmail) || undefined, phone: str(args.contactPhone) || undefined, source: "agent" });
    return contact.id;
  }
  return null;
}

const contactProps = {
  contactId: { type: "string", description: "Attach to this contact (from search_contacts)." },
  contactEmail: { type: "string", description: "Or attach to the contact with this email (created if new)." },
};

/** RJ's own tools, re-exposed. Read-only ones need "read"; ones that change data or draft need "write". */
const RJ_READ = new Set([
  "search_contacts", "get_contact", "list_tasks", "get_calendar", "find_open_slots", "pipeline_summary", "list_pipelines", "list_funnels",
  "pending_approvals", "daily_triage", "search_history", "search_files", "read_file_text",
]);
const RJ_SKIP = new Set(["request_computer_task"]);

const HUB_TOOLS: Tool[] = [
  {
    name: "push_file",
    scope: "write",
    description: `Save a file into Pamela's Library in Pamela OS (${BRAND.name}) and drop it in her Command Center inbox. Send the content as base64, as plain text, or as a public url for Pamela OS to download (use url for anything over a few MB).`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "File name with extension, e.g. board-report.pdf" },
        base64: { type: "string", description: "File bytes, base64-encoded" },
        text: { type: "string", description: "Or: the file's text (for .txt, .md, .csv, .html)" },
        url: { type: "string", description: "Or: a link to download (Drive and Dropbox share links work)" },
        mime: { type: "string" },
        description: { type: "string", description: "What this is and why Pamela needs it" },
        tags: { type: "array", items: { type: "string" } },
        computerTaskId: { type: "string", description: "Hermes only: the computer task this file came from" },
        ...contactProps,
      },
    },
    async run(a, key) {
      const tags = Array.isArray(a.tags) ? a.tags.map(String).slice(0, 20) : [];
      const taskId = /^[0-9a-f-]{36}$/i.test(str(a.computerTaskId)) ? str(a.computerTaskId) : null;
      const { file, item } = await pushFile({
        source: sourceOf(key),
        agentKeyId: key.id,
        name: str(a.name) || undefined,
        mime: str(a.mime) || undefined,
        base64: a.base64 != null ? str(a.base64) : undefined,
        text: a.text != null ? str(a.text) : undefined,
        url: str(a.url) || undefined,
        description: str(a.description) || null,
        tags,
        contactId: await contactIdFrom(a),
        computerTaskId: taskId,
      });
      return { saved: true, fileId: file.id, name: file.name, size: file.size, inboxItemId: item.id };
    },
  },
  {
    name: "push_note",
    scope: "write",
    description: "Send Pamela a note, summary, research result or link. It lands in her Command Center inbox (and on a contact's timeline if you name one).",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string" }, url: { type: "string" }, ...contactProps },
      required: ["title"],
    },
    async run(a, key) {
      const item = await addInboxItem({
        kind: a.url ? "link" : "note",
        source: sourceOf(key),
        agentKeyId: key.id,
        title: str(a.title),
        body: str(a.body).slice(0, 50_000) || null,
        url: str(a.url) || null,
        contactId: await contactIdFrom(a),
      });
      return { saved: true, inboxItemId: item.id };
    },
  },
  {
    name: "get_file",
    scope: "read",
    description: "Fetch a Library file. Text files come back as text; other files as a temporary download link (and base64 when under 2 MB and include_base64 is true).",
    inputSchema: { type: "object", properties: { fileId: { type: "string" }, include_base64: { type: "boolean" } }, required: ["fileId"] },
    async run(a) {
      const id = str(a.fileId);
      const f = /^[0-9a-f-]{36}$/i.test(id) ? await readFile(id) : null;
      if (!f) return { error: "not found" };
      const out: Record<string, unknown> = { fileId: id, name: f.name, mime: f.mime, size: f.data.byteLength, url: signedMediaUrl(id, 3600) };
      if (isTextFile(f.mime, f.name)) out.text = f.data.toString("utf8").slice(0, 100_000);
      else if (a.include_base64 && f.data.byteLength <= 2 * 1024 * 1024) out.base64 = f.data.toString("base64");
      return out;
    },
  },
  {
    name: "list_inbox",
    scope: "read",
    description: "What has been pushed into Pamela's Command Center inbox recently.",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["new", "filed", "dismissed", "all"] } } },
    async run(a) {
      const db = await getDb();
      const status = str(a.status) || "new";
      const rows = await db
        .select()
        .from(schema.inboxItems)
        .where(status === "all" ? undefined : eq(schema.inboxItems.status, status))
        .orderBy(desc(schema.inboxItems.createdAt))
        .limit(30);
      return rows.map((r) => ({ id: r.id, kind: r.kind, source: r.source, title: r.title, body: r.body?.slice(0, 500), url: r.url, fileId: r.fileId, status: r.status, at: r.createdAt.toISOString() }));
    },
  },
  {
    name: "request_computer_task",
    scope: "computer",
    description:
      "Ask Hermes Agent to do something on Pamela's computer or in her browser. Your request waits in her Command Center for her approval before Hermes starts. Hermes never sends, posts or pays.",
    inputSchema: {
      type: "object",
      properties: { instruction: { type: "string" }, kind: { type: "string", enum: ["browser", "computer", "files"] } },
      required: ["instruction"],
    },
    async run(a, key) {
      const kind = (["browser", "computer", "files"].includes(str(a.kind)) ? str(a.kind) : "browser") as ComputerKind;
      // A task Hermes queues for itself is still an agent's request, so it waits for her yes too.
      const t = await createComputerTask(str(a.instruction), kind, sourceOf(key));
      return { taskId: t.id, status: t.status };
    },
  },
  {
    name: "computer_task_status",
    scope: "computer",
    description: "Check computer tasks: one by id, or the latest ten.",
    inputSchema: { type: "object", properties: { taskId: { type: "string" } } },
    async run(a) {
      const db = await getDb();
      const id = str(a.taskId);
      const rows = /^[0-9a-f-]{36}$/i.test(id)
        ? await db.select().from(schema.computerTasks).where(eq(schema.computerTasks.id, id))
        : await db.select().from(schema.computerTasks).orderBy(desc(schema.computerTasks.createdAt)).limit(10);
      return rows.map((t) => ({ id: t.id, instruction: t.instruction, kind: t.kind, status: t.status, result: t.result, error: t.error, fileIds: t.fileIds }));
    },
  },
];

/** Hermes's side of the computer bridge (pull mode). Only keys made for Hermes see these. */
const HERMES_TOOLS: Tool[] = [
  {
    name: "next_computer_task",
    scope: "computer",
    description: "Hermes: claim the next approved task Pamela queued for her computer or browser. Returns null when there is nothing to do. Follow the rules that come with it.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const t = await claimNextComputerTask();
      return t ? { taskId: t.id, kind: t.kind, instruction: t.instruction, rules: COMPUTER_RULES } : null;
    },
  },
  {
    name: "finish_computer_task",
    scope: "computer",
    description: "Hermes: report a computer task as done (with a short summary) or failed (with the reason). Push any files first with push_file and computerTaskId.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, ok: { type: "boolean" }, summary: { type: "string" }, error: { type: "string" } },
      required: ["taskId", "ok"],
    },
    async run(a) {
      const id = str(a.taskId);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "taskId is required" };
      const db = await getDb();
      const [cur] = await db.select().from(schema.computerTasks).where(and(eq(schema.computerTasks.id, id), inArray(schema.computerTasks.status, ["running", "queued"])));
      if (!cur) return { error: "That task isn't running (it may have been cancelled)." };
      const t = await finishComputerTask(id, { ok: a.ok !== false, result: str(a.summary) || undefined, error: str(a.error) || undefined });
      return { taskId: t.id, status: t.status };
    },
  },
];

export function toolsFor(key: AgentKey): Tool[] {
  const rj: Tool[] = RJ_TOOLS.filter((t) => !RJ_SKIP.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
    scope: RJ_READ.has(t.name) ? "read" : "write",
    // "by" credits the agent on anything it creates (deal timelines, events).
    run: (args, k) => runTool(t.name, { ...args, by: k.client }),
  }));
  const all = [...HUB_TOOLS, ...(key.client === "hermes" ? HERMES_TOOLS : []), ...rj];
  return all.filter((t) => hasScope(key, t.scope));
}

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: RpcRequest["id"], result: unknown): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: RpcRequest["id"], code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Handles one JSON-RPC message. Returns null for notifications (no reply). */
export async function handleRpc(msg: RpcRequest, key: AgentKey): Promise<RpcResponse | null> {
  const isNotification = msg.id === undefined;
  const method = msg.method ?? "";
  if (method.startsWith("notifications/")) return null;
  switch (method) {
    case "initialize": {
      const asked = str(msg.params?.protocolVersion);
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "pamela-os", title: "Pamela OS", version: "1.0.0" },
        instructions: [
          `Pamela OS is the operating system for ${BRAND.name}: her CRM, tasks, calendar, files and approvals.`,
          `You are connected as “${key.name}” (${CLIENT_LABELS[key.client as AgentClient] ?? key.client}).`,
          "Use push_file and push_note to hand Pamela anything you made or found, and update_file to edit a Library file in place.",
          "You can build her pipelines (create_pipeline, add_pipeline_stage), deals (create_deal, update_deal, move_deal) and funnels (create_funnel); use list_pipelines and list_funnels first to avoid duplicates.",
          "Drafted emails and texts, and publishing a page, wait in her Approvals; nothing reaches another person until she says yes.",
        ].join(" "),
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: toolsFor(key).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.scope === "read" },
        })),
      });
    case "tools/call": {
      const name = str(msg.params?.name);
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
      const tool = toolsFor(key).find((t) => t.name === name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool or not allowed for this key: ${name}`);
      try {
        const result = await tool.run(args, key);
        const err = result && typeof result === "object" && "error" in result ? String((result as { error: unknown }).error) : null;
        return ok(msg.id, {
          content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result ?? null, null, 2) }],
          ...(result && typeof result === "object" && !Array.isArray(result) ? { structuredContent: result } : {}),
          isError: !!err,
        });
      } catch (e) {
        return ok(msg.id, { content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    case "resources/list":
      return ok(msg.id, { resources: [] });
    case "prompts/list":
      return ok(msg.id, { prompts: [] });
    default:
      return isNotification ? null : fail(msg.id, -32601, `Method not found: ${method}`);
  }
}

/** HTTP transport: one POST carries a JSON-RPC message (or a batch); replies are plain JSON. */
export async function mcpHttp(req: Request, token: string | null): Promise<Response> {
  const { verifyAgentKey } = await import("./keys");
  const key = await verifyAgentKey(token);
  if (!key) {
    return Response.json(fail(null, -32001, "Unauthorized: use an agent key from Pamela OS → Command Center → Connect agents."), {
      status: 401,
      headers: { "www-authenticate": 'Bearer realm="pamela-os"' },
    });
  }
  if (req.method === "GET") return new Response("This MCP server answers POST requests only.", { status: 405, headers: { allow: "POST, DELETE" } });
  if (req.method === "DELETE") return new Response(null, { status: 204 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  }
  const headers = { "mcp-protocol-version": PROTOCOL_VERSIONS[0] };
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleRpc(m as RpcRequest, key)))).filter(Boolean);
    return replies.length ? Response.json(replies, { headers }) : new Response(null, { status: 202 });
  }
  const reply = await handleRpc(body as RpcRequest, key);
  return reply ? Response.json(reply, { headers }) : new Response(null, { status: 202 });
}
