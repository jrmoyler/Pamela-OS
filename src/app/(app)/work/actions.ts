"use server";

import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { emit } from "@/lib/events";
import { logActivity } from "@/lib/crm";
import { getSetting } from "@/lib/settings";
import { zonedToUtc } from "@/lib/time";
import { requireSession } from "@/lib/auth";

async function parseLocalDate(v: FormDataEntryValue | null) {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  const [hh, mm] = (s.slice(11, 16) || "17:00").split(":").map(Number);
  return zonedToUtc(y, m, d, hh, mm, await getSetting("timezone"));
}

export async function createTask(form: FormData) {
  await requireSession();
  const db = await getDb();
  const title = String(form.get("title") ?? "").trim();
  if (!title) return;
  const [task] = await db
    .insert(schema.tasks)
    .values({
      title,
      description: String(form.get("description") ?? "") || null,
      dueAt: await parseLocalDate(form.get("due")),
      priority: String(form.get("priority") || "normal"),
      contactId: String(form.get("contactId") || "") || null,
      source: "manual",
    })
    .returning();
  const boardId = String(form.get("boardId") || "");
  if (boardId) {
    const [{ value }] = await db.select({ value: max(schema.boardItems.position) }).from(schema.boardItems).where(eq(schema.boardItems.boardId, boardId));
    await db.insert(schema.boardItems).values({ boardId, taskId: task.id, columnKey: String(form.get("column") || "todo"), position: (value ?? 0) + 1 });
  }
  await emit("task.created", { taskId: task.id, contactId: task.contactId, source: "manual" }, "work");
  revalidatePath("/work");
  revalidatePath("/");
}

export async function setTaskStatus(taskId: string, status: "todo" | "doing" | "done") {
  await requireSession();
  const db = await getDb();
  const [t] = await db
    .update(schema.tasks)
    .set({ status, completedAt: status === "done" ? new Date() : null, updatedAt: new Date() })
    .where(eq(schema.tasks.id, taskId))
    .returning();
  if (t && status === "done") {
    await emit("task.completed", { taskId: t.id, contactId: t.contactId }, "work");
    if (t.contactId) await logActivity({ type: "task", contactId: t.contactId, title: `Completed: ${t.title}` });
    // Keep boards in sync: completed tasks move to the Done column.
    await db.update(schema.boardItems).set({ columnKey: "done" }).where(eq(schema.boardItems.taskId, t.id));
  } else if (t) {
    // Reopening (e.g. unticking on Work/Today) takes the card out of Done too.
    await db.update(schema.boardItems).set({ columnKey: status }).where(and(eq(schema.boardItems.taskId, t.id), eq(schema.boardItems.columnKey, "done")));
  }
  revalidatePath("/work");
  revalidatePath("/");
}

export async function toggleTask(taskId: string, done: boolean) {
  await requireSession();
  await setTaskStatus(taskId, done ? "done" : "todo");
}

export async function updateTask(taskId: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  await db
    .update(schema.tasks)
    .set({
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? "") || null,
      dueAt: await parseLocalDate(form.get("due")),
      priority: String(form.get("priority") || "normal"),
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, taskId));
  revalidatePath("/work");
}

export async function deleteTask(taskId: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
  revalidatePath("/work");
  revalidatePath("/");
}

/** Drag & drop on a board. Moving into "done" completes the task; out of it reopens. */
export async function moveBoardItem(itemId: string, columnKey: string, position: number) {
  await requireSession();
  const db = await getDb();
  const [item] = await db.update(schema.boardItems).set({ columnKey, position }).where(eq(schema.boardItems.id, itemId)).returning();
  if (!item) return;
  const status = columnKey === "done" ? "done" : columnKey === "doing" ? "doing" : "todo";
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, item.taskId));
  if (task && task.status !== status) {
    if (status === "done") await setTaskStatus(task.id, "done");
    else await db.update(schema.tasks).set({ status, completedAt: null, updatedAt: new Date() }).where(eq(schema.tasks.id, task.id));
  }
  revalidatePath(`/work/${item.boardId}`);
}

export async function addTaskToBoard(boardId: string, taskId: string) {
  await requireSession();
  const db = await getDb();
  await db.insert(schema.boardItems).values({ boardId, taskId, columnKey: "todo", position: 0 }).onConflictDoNothing();
  revalidatePath(`/work/${boardId}`);
}

export async function createBoard(form: FormData) {
  await requireSession();
  const db = await getDb();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  await db.insert(schema.boards).values({
    name,
    businessLine: String(form.get("businessLine") || "") || null,
    columns: [
      { key: "todo", name: "To do" },
      { key: "doing", name: "In progress" },
      { key: "waiting", name: "Waiting on others" },
      { key: "done", name: "Done" },
    ],
  });
  revalidatePath("/work");
}

export async function removeFromBoard(itemId: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.boardItems).where(and(eq(schema.boardItems.id, itemId)));
  revalidatePath("/work");
}
