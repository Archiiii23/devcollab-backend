import { Router, type Response } from "express";
import { z } from "zod";
import { type AuthedRequest, requireUser } from "../auth.js";
import { Project, Snippet, Task, WikiPage, Workspace, WorkspaceMember } from "../models.js";
import { publicProject } from "../serialize.js";
import { asyncH, ensureRole, withWorkspace } from "../middleware.js";
import { prefixedId, slugify } from "../ids.js";
import { ok, fail } from "../util.js";
import { logActivity } from "../activity.js";
import { FREE_LIMITS, projectByIdOrSlug } from "../workspace.js";

export const projectRoutes = Router();

projectRoutes.get(
  "/projects",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const rows = await Project.find({ workspaceId: req.workspaceId!, archived: { $ne: true } })
      .sort({ createdAt: 1 })
      .lean();
    return ok(res, { projects: rows.map(publicProject) });
  }),
);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  color: z.string().max(64).optional(),
  icon: z.string().max(64).optional(),
});

projectRoutes.post(
  "/projects",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    if (!(await ensureRole(wsId, req.user!.id, "member"))) return fail(res, 403, "Member required");

    const ws = await Workspace.findById(wsId).lean();
    const projectCount = await Project.countDocuments({ workspaceId: wsId, archived: { $ne: true } });
    if (ws?.tier === "free" && projectCount >= FREE_LIMITS.projects) {
      return fail(res, 402, `Free tier limited to ${FREE_LIMITS.projects} projects. Upgrade to add more.`);
    }

    const body = createSchema.parse(req.body);
    let slug = slugify(body.name);
    // Ensure unique within workspace
    while (await Project.findOne({ workspaceId: wsId, slug }).lean()) {
      slug = `${slugify(body.name)}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const id = prefixedId("prj");
    const doc = await Project.create({
      _id: id,
      workspaceId: wsId,
      name: body.name.trim(),
      slug,
      description: body.description ?? "",
      color: body.color ?? "oklch(0.65 0.14 240)",
      icon: body.icon ?? "",
    });
    await logActivity({
      workspaceId: wsId,
      projectId: id,
      actorId: req.user!.id,
      action: "created",
      targetType: "project",
      targetId: id,
      targetLabel: doc.name,
    });
    return ok(res, { project: publicProject(doc) }, 201);
  }),
);

projectRoutes.get(
  "/projects/:idOrSlug",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const proj = await projectByIdOrSlug(req.workspaceId!, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");
    return ok(res, { project: publicProject(proj) });
  }),
);

const updateSchema = createSchema.partial();

projectRoutes.patch(
  "/projects/:idOrSlug",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    if (!(await ensureRole(wsId, req.user!.id, "member"))) return fail(res, 403, "Member required");
    const proj = await projectByIdOrSlug(wsId, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");
    const body = updateSchema.parse(req.body);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name.trim();
    if (body.description !== undefined) update.description = body.description;
    if (body.color !== undefined) update.color = body.color;
    if (body.icon !== undefined) update.icon = body.icon;
    if (Object.keys(update).length) await Project.updateOne({ _id: proj._id }, { $set: update });
    const fresh = await Project.findById(proj._id).lean();
    return ok(res, { project: publicProject(fresh!) });
  }),
);

projectRoutes.delete(
  "/projects/:idOrSlug",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    if (!(await ensureRole(wsId, req.user!.id, "admin"))) return fail(res, 403, "Admin required");
    const proj = await projectByIdOrSlug(wsId, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");

    await Promise.all([
      Task.deleteMany({ projectId: proj._id }),
      WikiPage.deleteMany({ projectId: proj._id }),
      Snippet.deleteMany({ projectId: proj._id }),
    ]);
    await Project.deleteOne({ _id: proj._id });
    await logActivity({
      workspaceId: wsId,
      projectId: proj._id,
      actorId: req.user!.id,
      action: "deleted",
      targetType: "project",
      targetId: proj._id,
      targetLabel: proj.name,
    });
    return ok(res, { ok: true });
  }),
);

// suppress unused
void WorkspaceMember;
