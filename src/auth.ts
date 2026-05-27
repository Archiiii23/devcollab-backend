import { randomBytes, pbkdf2, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { Session, User } from "./models.js";
import { prefixedId } from "./ids.js";

const pbkdf2Async = promisify(pbkdf2);

const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const SESSION_COOKIE = "devcollab_session";

async function deriveHash(password: string, salt: Buffer): Promise<Buffer> {
  return pbkdf2Async(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveHash(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iter = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iter) || iter < 1000) return false;
  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  const computed = await deriveHash(password, salt);
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

export async function createSession(userId: string) {
  const id = `sess_${randomBytes(18).toString("base64url")}`;
  await Session.create({
    _id: id,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return { id, userId };
}

export async function deleteSession(id: string): Promise<void> {
  await Session.deleteOne({ _id: id });
}

export async function getSessionUser(id: string | undefined) {
  if (!id) return null;
  const sess = await Session.findOne({ _id: id, expiresAt: { $gt: new Date() } }).lean();
  if (!sess) return null;
  const user = await User.findOne({ _id: sess.userId }).lean();
  return user ?? null;
}

function buildCookie(value: string, maxAgeSec: number, req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const isHttps = proto === "https";
  const origin = req.headers.origin as string | undefined;
  const host = req.hostname;
  let crossOrigin = false;
  if (origin) {
    try {
      const originHost = new URL(origin).hostname;
      crossOrigin = originHost !== host;
    } catch {
      crossOrigin = false;
    }
  }
  const sameSite = crossOrigin ? "None" : "Lax";
  const secure = isHttps || sameSite === "None";
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push("Secure");
  const domain = process.env.SESSION_COOKIE_DOMAIN;
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

export function setSessionCookie(req: Request, res: Response, sessionId: string): void {
  res.setHeader("set-cookie", buildCookie(sessionId, SESSION_TTL_MS / 1000, req));
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.setHeader("set-cookie", buildCookie("", 0, req));
}

export function readSessionCookie(req: Request): string | undefined {
  return req.cookies?.[SESSION_COOKIE];
}

// ---------- Middleware ----------

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; name: string; avatarColor: string };
  workspaceId?: string;
}

export async function attachUser(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
  const sid = readSessionCookie(req);
  if (sid) {
    const u = await getSessionUser(sid);
    if (u) {
      req.user = { id: u._id, email: u.email, name: u.name, avatarColor: u.avatarColor };
    }
  }
  next();
}

export function requireUser(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: { message: "Not authenticated" } });
    return;
  }
  next();
}

// ---------- Helpers ----------

export const COLOR_POOL = [
  "oklch(0.7 0.15 155)",
  "oklch(0.65 0.14 240)",
  "oklch(0.78 0.14 80)",
  "oklch(0.6 0.18 27)",
  "oklch(0.6 0.1 200)",
  "oklch(0.65 0.16 320)",
  "oklch(0.62 0.14 110)",
];

export function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLOR_POOL[h % COLOR_POOL.length];
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function newUserId(): string {
  return prefixedId("usr");
}
