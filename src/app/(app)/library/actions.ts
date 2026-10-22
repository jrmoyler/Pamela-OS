"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { importFromDrive, importFromDropbox, importFromUrl, syncSources } from "@/lib/hub/sources";

const back = (tab: string, msg: string, error = false) => redirect(`/library?tab=${tab}&${error ? "error" : "ok"}=${encodeURIComponent(msg)}`);

export async function importLink(form: FormData) {
  await requireSession();
  const url = String(form.get("url") ?? "").trim();
  let msg: string;
  try {
    const f = await importFromUrl(url, { description: String(form.get("description") ?? "") || null });
    msg = `Saved “${f.name}”.`;
  } catch (e) {
    back("all", (e as Error).message, true);
    return;
  }
  revalidatePath("/library");
  back("all", msg);
}

export async function pullFromDrive(id: string) {
  await requireSession();
  let msg: string;
  try {
    msg = `Pulled “${(await importFromDrive(id)).name}” from Google Drive.`;
  } catch (e) {
    back("gdrive", (e as Error).message, true);
    return;
  }
  revalidatePath("/library");
  back("gdrive", msg);
}

export async function pullFromDropbox(id: string) {
  await requireSession();
  let msg: string;
  try {
    msg = `Pulled “${(await importFromDropbox(id)).name}” from Dropbox.`;
  } catch (e) {
    back("dropbox", (e as Error).message, true);
    return;
  }
  revalidatePath("/library");
  back("dropbox", msg);
}

export async function syncNow() {
  await requireSession();
  const out = await syncSources(true);
  const parts = Object.entries(out).map(([k, v]) => `${k === "gdrive" ? "Drive" : "Dropbox"}: ${typeof v === "number" ? `${v} new` : v}`);
  revalidatePath("/library");
  back("all", parts.length ? parts.join(" · ") : "No auto-pull folders are set. Add one in Settings → File sources.");
}
