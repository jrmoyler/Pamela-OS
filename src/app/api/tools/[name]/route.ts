import { NextResponse } from "next/server";
import { runRestTool } from "@/lib/hub/rest";

export const maxDuration = 300;

/** POST /api/tools/{name} with the tool's arguments as the JSON body. */
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  let args: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      args = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "The body must be JSON." }, { status: 400 });
    }
  }
  return runRestTool(req, name, args);
}
