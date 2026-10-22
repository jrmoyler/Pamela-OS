import { NextResponse } from "next/server";
import { cleanupDictation } from "@/lib/dictation";

export async function POST(req: Request) {
  const { text, ai } = (await req.json()) as { text: string; ai?: boolean };
  return NextResponse.json(await cleanupDictation(text ?? "", ai !== false));
}
