import { Router, type Response } from "express";
import { z } from "zod";
import { type AuthedRequest, requireUser, initialsFromName } from "../auth.js";
import { Presence } from "../models.js";
import { asyncH, withWorkspace } from "../middleware.js";
import { ok, fail } from "../util.js";
import { ensureProjectAccess, projectByIdOrSlug } from "../workspace.js";

export const presenceRoutes = Router();

const heartbeatSchema = z.object({});

presenceRoutes.post(
  "/projects/:idOrSlug/presence",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const proj = await projectByIdOrSlug(req.workspaceId!, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");
    heartbeatSchema.parse(req.body ?? {});
    await Presence.updateOne(
      { projectId: proj._id, userId: req.user!.id },
      {
        $set: {
          projectId: proj._id,
          userId: req.user!.id,
          name: req.user!.name,
          initials: initialsFromName(req.user!.name),
          avatarColor: req.user!.avatarColor,
          lastSeen: new Date(),
        },
      },
      { upsert: true },
    );
    return ok(res, { ok: true });
  }),
);

presenceRoutes.get(
  "/projects/:idOrSlug/presence",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const proj = await projectByIdOrSlug(req.workspaceId!, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");
    const access = await ensureProjectAccess(req.user!.id, proj._id);
    if (!access) return fail(res, 403, "Forbidden");
    const since = new Date(Date.now() - 60_000);
    const peers = await Presence.find({ projectId: proj._id, lastSeen: { $gte: since } }).lean();
    return ok(res, {
      users: peers.map((p) => ({
        id: p.userId,
        name: p.name,
        initials: p.initials,
        avatarColor: p.avatarColor,
        avatarUrl: p.avatarUrl,
        lastSeen: p.lastSeen,
      })),
    });
  }),
);
