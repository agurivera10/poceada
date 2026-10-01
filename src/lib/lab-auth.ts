import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "poceada_lab_admin";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function required(name: "LAB_ADMIN_PASSWORD" | "LAB_SESSION_SECRET") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function verifyLabPassword(candidate: string) {
  const expected = required("LAB_ADMIN_PASSWORD");
  return timingSafeEqual(digest(candidate), digest(expected));
}

function signature(payload: string) {
  return createHmac("sha256", required("LAB_SESSION_SECRET")).update(payload).digest("hex");
}

export function createLabToken() {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = String(expires);
  return `${payload}.${signature(payload)}`;
}

export function verifyLabToken(token: string | undefined) {
  if (!token) return false;
  const [expiresRaw, received] = token.split(".");
  if (!expiresRaw || !received || !/^\d+$/.test(expiresRaw) || !/^[0-9a-f]{64}$/.test(received)) return false;
  if (Number(expiresRaw) <= Math.floor(Date.now() / 1000)) return false;
  const expected = signature(expiresRaw);
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

export async function isLabAdmin() {
  const store = await cookies();
  return verifyLabToken(store.get(COOKIE_NAME)?.value);
}

export async function setLabSession() {
  const store = await cookies();
  store.set(COOKIE_NAME, createLabToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearLabSession() {
  const store = await cookies();
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
