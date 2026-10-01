import { NextResponse } from "next/server";
import { setLabSession, verifyLabPassword } from "@/lib/lab-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const password = typeof body?.password === "string" ? body.password : "";
    if (!password || !verifyLabPassword(password)) {
      return NextResponse.json({ ok: false, error: "Credenciales inválidas." }, { status: 401 });
    }
    await setLabSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo iniciar sesión." }, { status: 500 });
  }
}
