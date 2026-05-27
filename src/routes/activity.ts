import { Router, type Response } from "express";
import { type AuthedRequest, requireUser } from "../auth.js";
import { Activity, Project, Snippet, Task, User, WikiPage } from "../models.js";
import { publicUser } from "../serialize.js";
import { asyncH, withWorkspace } from "../middleware.js";
import { ok } from "../util.js";

export const activityRoutes = Router();

activityRoutes.get(
  "/activity",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit ?? 50)));
    const rows = await Activity.find({ workspaceId: req.workspaceId! })
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
        projectId: r.projectId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        targetLabel: r.targetLabel,
        meta: r.meta,
        actor: r.actorId ? (map.get(r.actorId) ?? null) : null,
        createdAt: r.createdAt,
      })),
    });
  }),
);

activityRoutes.get(
  "/search",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return ok(res, { results: [] });

    const projects = await Project.find({ workspaceId: req.workspaceId! }).lean();
    const projectIds = projects.map((p) => p._id);
    const projectMap = new Map(projects.map((p) => [p._id, p]));
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    const [matchProjects, matchTasks, matchWiki, matchSnippets] = await Promise.all([
      Project.find({ workspaceId: req.workspaceId!, $or: [{ name: re }, { description: re }] }).limit(10).lean(),
      Task.find({ projectId: { $in: projectIds }, $or: [{ title: re }, { description: re }] }).limit(10).lean(),
      WikiPage.find({ projectId: { $in: projectIds }, $or: [{ title: re }, { content: re }] }).limit(10).lean(),
      Snippet.find({ projectId: { $in: projectIds }, $or: [{ title: re }, { description: re }, { code: re }] }).limit(10).lean(),
    ]);

    const results = [
      ...matchProjects.map((p) => ({
        kind: "project",
        id: p._id,
        title: p.name,
        subtitle: p.description ?? "",
        projectId: p._id,
        projectSlug: p.slug,
      })),
      ...matchTasks.map((t) => ({
        kind: "task",
        id: t._id,
        title: t.title,
        subtitle: t.status,
        projectId: t.projectId,
        projectSlug: projectMap.get(t.projectId)?.slug,
      })),
      ...matchWiki.map((w) => ({
        kind: "wiki",
        id: w._id,
        title: w.title,
        subtitle: w.category,
        projectId: w.projectId,
        projectSlug: projectMap.get(w.projectId)?.slug,
      })),
      ...matchSnippets.map((s) => ({
        kind: "snippet",
        id: s._id,
        title: s.title,
        subtitle: s.language,
        projectId: s.projectId,
        projectSlug: projectMap.get(s.projectId)?.slug,
      })),
    ];

    return ok(res, { results });
  }),
);
