import { Router, type Response } from "express";
import { type AuthedRequest, requireUser } from "../auth.js";
import { Notification, User } from "../models.js";
import { publicUser } from "../serialize.js";
import { asyncH } from "../middleware.js";
import { ok } from "../util.js";

export const notificationRoutes = Router();

notificationRoutes.get(
  "/notifications",
  requireUser,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const limit = Math.min(100, Math.max(5, Number(req.query.limit ?? 30)));
    const rows = await Notification.find({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const actorIds = Array.from(
      new Set(rows.map((r) => r.actorId).filter((v): v is string => Boolean(v))),
    );
    const actors = actorIds.length ? await User.find({ _id: { $in: actorIds } }).lean() : [];
    const map = new Map(actors.map((u) => [u._id, publicUser(u)]));
    return ok(res, {
      items: rows.map((r) => ({
        id: r._id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        targetType: r.targetType,
        targetId: r.targetId,
        projectId: r.projectId,
        readAt: r.readAt,
        actor: r.actorId ? (map.get(r.actorId) ?? null) : null,
        createdAt: r.createdAt,
        meta: r.meta,
      })),
      unread: rows.filter((r) => !r.readAt).length,
    });
  }),
);

notificationRoutes.post(
  "/notifications/:id/read",
  requireUser,
  asyncH(async (req: AuthedRequest, res: Response) => {
    await Notification.updateOne(
      { _id: req.params.id, userId: req.user!.id },
      { $set: { readAt: new Date() } },
    );
    return ok(res, { ok: true });
  }),
);

notificationRoutes.post(
  "/notifications/read-all",
  requireUser,
  asyncH(async (req: AuthedRequest, res: Response) => {
    await Notification.updateMany(
      { userId: req.user!.id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return ok(res, { ok: true });
  }),
);
