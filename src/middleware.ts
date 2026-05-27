import type { Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthedRequest } from "./auth.js";
import { getActiveWorkspaceId, getMemberRole } from "./workspace.js";
import { fail } from "./util.js";

/**
 * Resolves the active workspace for the authenticated user and attaches it
 * to req.workspaceId. Returns 404 if the user belongs to no workspace.
 */
export async function withWorkspace(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    fail(res, 401, "Not authenticated");
    return;
  }
  const wsId = await getActiveWorkspaceId(req.user.id);
  if (!wsId) {
    fail(res, 404, "No workspace");
    return;
  }
  req.workspaceId = wsId;
  next();
}

export async function ensureRole(
  workspaceId: string,
  userId: string,
  required: "owner" | "admin" | "member" | "viewer",
): Promise<boolean> {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) return false;
  const order = { viewer: 0, member: 1, admin: 2, owner: 3 };
  return order[role as keyof typeof order] >= order[required];
}

export function zParse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}

export function asyncH(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
