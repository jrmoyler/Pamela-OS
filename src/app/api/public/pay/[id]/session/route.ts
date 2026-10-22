import { NextResponse } from "next/server";
import { createEmbeddedCheckout } from "@/lib/modules/payments";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await createEmbeddedCheckout(id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
