"use server";

import { revalidatePath } from "next/cache";
import { approveAndExecute, rejectApproval, updateApprovalPayload, applyBrandFixes, retryApproval } from "@/lib/approvals";
import { requireSession } from "@/lib/auth";

const TEXT_KEYS = ["to", "subject", "body", "message", "caption"];

export async function approveItem(id: string, form: FormData) {
  await requireSession();
  const patch: Record<string, unknown> = {};
  for (const k of TEXT_KEYS) if (form.has(k)) patch[k] = String(form.get(k));
  if (Object.keys(patch).length) await updateApprovalPayload(id, patch);
  await approveAndExecute(id);
  revalidatePath("/approvals");
  revalidatePath("/", "layout");
}

export async function saveItem(id: string, form: FormData) {
  await requireSession();
  const patch: Record<string, unknown> = {};
  for (const k of TEXT_KEYS) if (form.has(k)) patch[k] = String(form.get(k));
  await updateApprovalPayload(id, patch);
  revalidatePath("/approvals");
}

export async function rejectItem(id: string, form: FormData) {
  await requireSession();
  await rejectApproval(id, String(form.get("reason") ?? "") || undefined);
  revalidatePath("/approvals");
  revalidatePath("/", "layout");
}

export async function fixBrand(id: string) {
  await requireSession();
  await applyBrandFixes(id);
  revalidatePath("/approvals");
}

export async function retryItem(id: string) {
  await requireSession();
  await retryApproval(id);
  revalidatePath("/approvals");
}

export async function approveAll(ids: string[]) {
  await requireSession();
  for (const id of ids) {
    try {
      await approveAndExecute(id);
    } catch {
      /* already handled / not pending */
    }
  }
  revalidatePath("/approvals");
  revalidatePath("/", "layout");
}
