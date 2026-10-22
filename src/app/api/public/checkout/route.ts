import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { createPaymentRequest } from "@/lib/modules/payments";

/** "Buy now" on a product block → pending payment → in-app /pay page. Price comes from the page, never the browser. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const slug = String(form.get("page") ?? "");
  const blockId = String(form.get("block") ?? "");
  const db = await getDb();
  const [page] = await db.select().from(schema.pages).where(and(eq(schema.pages.slug, slug), eq(schema.pages.published, true)));
  const block = page?.blocks.find((b) => b.id === blockId && b.type === "product");
  const cents = Number(block?.props.priceCents) || 0;
  if (!page || !block || cents <= 0) return NextResponse.redirect(new URL(page ? `/p/${page.slug}` : "/", req.url), 303);
  const payment = await createPaymentRequest({ contactId: null, amountCents: cents, description: String(block.props.name || page.title) });
  return NextResponse.redirect(new URL(`/pay/${payment.id}`, req.url), 303);
}
