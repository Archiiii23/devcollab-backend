import type { Response } from "express";

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ data });
}

export function fail(res: Response, status: number, message: string, extra?: Record<string, unknown>) {
  return res.status(status).json({ error: { message, ...(extra ?? {}) } });
}

export async function readJson<T>(req: { body: T }, fallback: Partial<T> = {} as Partial<T>): Promise<T> {
  return ((req.body ?? fallback) as T) ?? (fallback as T);
}
