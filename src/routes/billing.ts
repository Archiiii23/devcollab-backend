import { Router, type Response } from "express";
import { z } from "zod";
import { type AuthedRequest, requireUser } from "../auth.js";
import { Project, Workspace, WorkspaceMember } from "../models.js";
import { asyncH, ensureRole, withWorkspace } from "../middleware.js";
import { ok, fail } from "../util.js";
import { FREE_LIMITS } from "../workspace.js";
import { logActivity } from "../activity.js";

export const billingRoutes = Router();

billingRoutes.get(
  "/billing",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    const ws = await Workspace.findById(wsId).lean();
    const [projects, members] = await Promise.all([
      Project.countDocuments({ workspaceId: wsId, archived: { $ne: true } }),
      WorkspaceMember.countDocuments({ workspaceId: wsId }),
    ]);
    return ok(res, {
      tier: ws?.tier ?? "free",
      tierUpdatedAt: ws?.tierUpdatedAt ?? null,
      limits: { ...FREE_LIMITS },
      usage: { projects, members },
    });
  }),
);

const checkoutSchema = z.object({ plan: z.enum(["pro", "free"]) });

billingRoutes.post(
  "/billing/checkout",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    if (!(await ensureRole(wsId, req.user!.id, "owner"))) return fail(res, 403, "Owner required");
    const body = checkoutSchema.parse(req.body);
    await Workspace.updateOne(
      { _id: wsId },
      { $set: { tier: body.plan, tierUpdatedAt: new Date() } },
    );
    await logActivity({
      workspaceId: wsId,
      actorId: req.user!.id,
      action: body.plan === "pro" ? "upgraded" : "downgraded",
      targetType: "workspace",
      targetId: wsId,
      targetLabel: `tier:${body.plan}`,
    });
    return ok(res, { tier: body.plan });
  }),
);
