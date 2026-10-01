import { NextResponse } from "next/server";
import { isLabAdmin } from "@/lib/lab-auth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ authorized: await isLabAdmin() });
}
