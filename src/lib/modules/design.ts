import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { getSecret } from "../settings";
import { putFile } from "../storage";

/**
 * Canva Connect integration (server-side only — Pamela never leaves Pamela OS).
 * Autofills her locked brand template, waits for the design, exports a PNG and
 * stores it so it shows up in the Design studio like any other export.
 */
const CANVA = "https://api.canva.com/rest/v1";

export async function canvaConfigured() {
  return !!(await getSecret("CANVA_ACCESS_TOKEN")) && !!(await getSecret("CANVA_BRAND_TEMPLATE_ID"));
}

async function canva(path: string, init: RequestInit = {}) {
  const token = await getSecret("CANVA_ACCESS_TOKEN");
  if (!token) throw new Error("Canva is not connected. Add the access token in Settings → Connections.");
  const res = await fetch(`${CANVA}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Canva ${res.status}: ${data?.message ?? data?.error ?? "request failed"}`);
  return data;
}

async function poll<T>(fn: () => Promise<{ status: string; value?: T; error?: string }>, tries = 40, delayMs = 2000): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const r = await fn();
    if (r.status === "success" && r.value !== undefined) return r.value;
    if (r.status === "failed") throw new Error(r.error || "Canva job failed");
    await new Promise((res) => setTimeout(res, delayMs));
  }
  throw new Error("Canva took too long — try again in a minute.");
}

export async function generateInCanva(designId: string) {
  const db = await getDb();
  const [design] = await db.select().from(schema.designs).where(eq(schema.designs.id, designId));
  if (!design) throw new Error("Design not found");
  const templateId = await getSecret("CANVA_BRAND_TEMPLATE_ID");
  if (!templateId) throw new Error("Set the Canva brand template ID in Settings → Connections.");

  const data: Record<string, { type: "text"; text: string }> = {};
  for (const [k, v] of Object.entries(design.fields)) {
    if (k === "photoFileId" || k === "caption" || !v) continue;
    data[k] = { type: "text", text: v };
  }
  const job = await canva("/autofills", { method: "POST", body: JSON.stringify({ brand_template_id: templateId, title: design.title, data }) });
  const canvaDesignId = await poll<string>(async () => {
    const r = await canva(`/autofills/${job.job.id}`);
    return { status: r.job.status, value: r.job.result?.design?.id, error: r.job.error?.message };
  });
  const exp = await canva("/exports", { method: "POST", body: JSON.stringify({ design_id: canvaDesignId, format: { type: "png" } }) });
  const url = await poll<string>(async () => {
    const r = await canva(`/exports/${exp.job.id}`);
    return { status: r.job.status, value: r.job.urls?.[0], error: r.job.error?.message };
  });
  const png = await fetch(url);
  if (!png.ok) throw new Error("Could not download the Canva export.");
  const file = await putFile(Buffer.from(await png.arrayBuffer()), `${design.title.replace(/[^\w-]+/g, "-")}-canva.png`, "image/png");
  await db.update(schema.designs).set({ canvaDesignId, exportFileId: file.id, updatedAt: new Date() }).where(eq(schema.designs.id, designId));
  return file.id;
}
