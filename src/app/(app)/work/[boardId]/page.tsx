import { notFound } from "next/navigation";
import { and, eq, ne, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { contactName } from "@/lib/crm";
import { PageHeader, Card, Input, Button, Select } from "@/components/ui";
import { Kanban } from "@/components/work/Kanban";
import { fmtDate } from "@/lib/utils";
import { moveBoardItem, createTask, addTaskToBoard } from "../actions";

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const db = await getDb();
  const [board] = await db.select().from(schema.boards).where(eq(schema.boards.id, boardId));
  if (!board) notFound();
  const tz = await getSetting("timezone");
  const items = await db
    .select({ i: schema.boardItems, t: schema.tasks, c: schema.contacts })
    .from(schema.boardItems)
    .innerJoin(schema.tasks, eq(schema.boardItems.taskId, schema.tasks.id))
    .leftJoin(schema.contacts, eq(schema.tasks.contactId, schema.contacts.id))
    .where(eq(schema.boardItems.boardId, boardId));
  const onBoard = items.map((x) => x.t.id);
  const loose = await db
    .select()
    .from(schema.tasks)
    .where(onBoard.length ? and(ne(schema.tasks.status, "done"), notInArray(schema.tasks.id, onBoard)) : ne(schema.tasks.status, "done"))
    .limit(100);
  const now = new Date();

  return (
    <>
      <PageHeader title={board.name} subtitle={board.businessLine ?? "Board"} />
      <Card className="mb-4 p-3">
        <form action={createTask} className="flex flex-wrap gap-2">
          <input type="hidden" name="boardId" value={boardId} />
          <Input name="title" placeholder="New card…" className="min-w-48 flex-1" required />
          <Input name="due" type="datetime-local" className="w-52" />
          <Select name="column" className="w-44">
            {board.columns.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </Select>
          <Button>Add card</Button>
        </form>
        {loose.length > 0 && (
          <form
            action={async (fd: FormData) => {
              "use server";
              await addTaskToBoard(boardId, String(fd.get("taskId")));
            }}
            className="mt-2 flex gap-2"
          >
            <Select name="taskId" className="flex-1">
              {loose.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
            <Button variant="outline">Add existing task</Button>
          </form>
        )}
      </Card>
      <Kanban
        columns={board.columns}
        onMove={moveBoardItem}
        cards={items.map(({ i, t, c }) => ({
          id: i.id,
          columnKey: i.columnKey,
          position: i.position,
          title: t.title,
          subtitle: [t.dueAt ? `Due ${fmtDate(t.dueAt, tz, { month: "short", day: "numeric" })}` : null, c ? contactName(c) : null].filter(Boolean).join(" · ") || undefined,
          badge: t.dueAt && t.dueAt < now && t.status !== "done" ? "overdue" : t.priority !== "normal" ? t.priority : undefined,
          tone: t.dueAt && t.dueAt < now && t.status !== "done" ? "red" : t.priority === "urgent" ? "red" : t.priority === "high" ? "amber" : "default",
        }))}
      />
    </>
  );
}
