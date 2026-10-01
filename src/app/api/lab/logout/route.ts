import { NextResponse } from "next/server";
import { clearLabSession } from "@/lib/lab-auth";

export const runtime = "nodejs";

export async function POST() {
  await clearLabSession();
  return NextResponse.json({ ok: true });
}
