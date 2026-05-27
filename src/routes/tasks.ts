import { Router, type Response } from "express";
import { z } from "zod";
import { type AuthedRequest, requireUser } from "../auth.js";
import {
  Notification,
  Task,
  TaskAttachment,
  TaskComment,
  User,
} from "../models.js";
import { publicTask, publicUser } from "../serialize.js";
import { asyncH, withWorkspace } from "../middleware.js";
import { prefixedId } from "../ids.js";
import { ok, fail } from "../util.js";
import { logActivity } from "../activity.js";
import { ensureProjectAccess, projectByIdOrSlug } from "../workspace.js";
import { postSlackForProject } from "./_integration-hooks.js";

export const taskRoutes = Router();

const STATUSES = ["backlog", "todo", "in_progress", "review", "done"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

async function attachAssignees(rows: Awaited<ReturnType<typeof Task.find>> | Array<Record<string, unknown>>) {
  const assigneeIds = Array.from(
    new Set(
      (rows as Array<{ assigneeId?: string | null }>)
        .map((r) => r.assigneeId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const users = assigneeIds.length ? await User.find({ _id: { $in: assigneeIds } }).lean() : [];
  return new Map(users.map((u) => [u._id, publicUser(u)]));
}

taskRoutes.get(
  "/projects/:idOrSlug/tasks",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const proj = await projectByIdOrSlug(req.workspaceId!, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");
    const rows = await Task.find({ projectId: proj._id })
      .sort({ position: 1, createdAt: 1 })
      .lean();
    const map = await attachAssignees(rows);
    return ok(res, { tasks: rows.map((r) => publicTask(r, map)) });
  }),
);

const createSchema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().max(4000).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  due: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  labels: z.array(z.object({ name: z.string().min(1).max(40), tone: z.string().max(20).optional() })).optional(),
});

taskRoutes.post(
  "/projects/:idOrSlug/tasks",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const proj = await projectByIdOrSlug(req.workspaceId!, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");
    const body = createSchema.parse(req.body);
    const status = body.status ?? "todo";

    const last = await Task.findOne({ projectId: proj._id, status })
      .sort({ position: -1 })
      .lean();
    const position = (last?.position ?? -1) + 1;

    const id = prefixedId("tsk");
    await Task.create({
      _id: id,
      projectId: proj._id,
      title: body.title.trim(),
      description: body.description ?? "",
      status,
      priority: body.priority ?? "medium",
      due: body.due ? new Date(body.due) : null,
      position,
      assigneeId: body.assigneeId ?? null,
      labels: (body.labels ?? []).map((l) => ({ name: l.name, tone: l.tone ?? "" })),
    });

    if (body.assigneeId && body.assigneeId !== req.user!.id) {
      await Notification.create({
        _id: prefixedId("ntf"),
        userId: body.assigneeId,
        workspaceId: req.workspaceId!,
        projectId: proj._id,
        kind: "task_assigned",
        title: "You were assigned a task",
        body: body.title,
        targetType: "task",
        targetId: id,
        actorId: req.user!.id,
      });
    }

    await logActivity({
      workspaceId: req.workspaceId!,
      projectId: proj._id,
      actorId: req.user!.id,
      action: "created",
      targetType: "task",
      targetId: id,
      targetLabel: body.title,
    });

    const fresh = await Task.findById(id).lean();
    const map = await attachAssignees(fresh ? [fresh] : []);
    return ok(res, { task: publicTask(fresh!, map) }, 201);
  }),
);

const updateSchema = createSchema.partial().extend({
  position: z.number().int().optional(),
});

taskRoutes.patch(
  "/tasks/:id",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const t = await Task.findById(req.params.id);
    if (!t) return fail(res, 404, "Task not found");
    const access = await ensureProjectAccess(req.user!.id, t.projectId);
    if (!access) return fail(res, 403, "Forbidden");

    const body = updateSchema.parse(req.body);
    const prevStatus = t.status;
    const prevAssignee = t.assigneeId ?? null;

    if (body.title !== undefined) t.title = body.title.trim();
    if (body.description !== undefined) t.description = body.description;
    if (body.status !== undefined) t.status = body.status;
    if (body.priority !== undefined) t.priority = body.priority;
    if (body.due !== undefined) t.due = body.due ? new Date(body.due) : null;
    if (body.position !== undefined) t.position = body.position;
    if (body.assigneeId !== undefined) t.assigneeId = body.assigneeId ?? null;
    if (body.labels !== undefined)
      t.labels = body.labels.map((l) => ({ name: l.name, tone: l.tone ?? "" })) as never;

    await t.save();

    // Notify newly assigned user
    if (
      body.assigneeId !== undefined &&
      body.assigneeId &&
      body.assigneeId !== prevAssignee &&
      body.assigneeId !== req.user!.id
    ) {
      await Notification.create({
        _id: prefixedId("ntf"),
        userId: body.assigneeId,
        workspaceId: req.workspaceId!,
        projectId: t.projectId,
        kind: "task_assigned",
        title: "You were assigned a task",
        body: t.title,
        targetType: "task",
        targetId: t._id,
        actorId: req.user!.id,
      });
    }

    if (body.status !== undefined && body.status !== prevStatus) {
      await logActivity({
        workspaceId: req.workspaceId!,
        projectId: t.projectId,
        actorId: req.user!.id,
        action: "moved",
        targetType: "task",
        targetId: t._id,
        targetLabel: t.title,
        meta: { from: prevStatus, to: body.status },
      });
      await postSlackForProject(
        t.projectId,
        `*${req.user!.name}* moved \`${t.title}\` from \`${prevStatus}\` → \`${body.status}\``,
      ).catch(() => {});
    }

    const map = await attachAssignees([t.toObject()]);
    return ok(res, { task: publicTask(t.toObject(), map) });
  }),
);

taskRoutes.delete(
  "/tasks/:id",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const t = await Task.findById(req.params.id).lean();
    if (!t) return fail(res, 404, "Task not found");
    const access = await ensureProjectAccess(req.user!.id, t.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    await Task.deleteOne({ _id: t._id });
    await TaskComment.deleteMany({ taskId: t._id });
    await TaskAttachment.deleteMany({ taskId: t._id });
    await logActivity({
      workspaceId: req.workspaceId!,
      projectId: t.projectId,
      actorId: req.user!.id,
      action: "deleted",
      targetType: "task",
      targetId: t._id,
      targetLabel: t.title,
    });
    return ok(res, { ok: true });
  }),
);

// ---------- Comments ----------

const mentionRegex = /@([a-zA-Z0-9._-]+)/g;

taskRoutes.get(
  "/tasks/:id/comments",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const t = await Task.findById(req.params.id).lean();
    if (!t) return fail(res, 404, "Task not found");
    const access = await ensureProjectAccess(req.user!.id, t.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const comments = await TaskComment.find({ taskId: t._id }).sort({ createdAt: 1 }).lean();
    const authors = await User.find({ _id: { $in: comments.map((c) => c.authorId) } }).lean();
    const map = new Map(authors.map((u) => [u._id, publicUser(u)]));
    return ok(res, {
      comments: comments.map((c) => ({
        id: c._id,
        body: c.body,
        mentions: c.mentions ?? [],
        author: map.get(c.authorId) ?? null,
        createdAt: c.createdAt,
      })),
    });
  }),
);

taskRoutes.post(
  "/tasks/:id/comments",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const t = await Task.findById(req.params.id).lean();
    if (!t) return fail(res, 404, "Task not found");
    const access = await ensureProjectAccess(req.user!.id, t.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const schema = z.object({ body: z.string().min(1).max(4000) });
    const body = schema.parse(req.body);

    const mentions: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = mentionRegex.exec(body.body)) !== null) {
      mentions.push(m[1]);
    }
    let mentionUserIds: string[] = [];
    if (mentions.length) {
      const found = await User.find({
        $or: mentions.map((handle) => ({ email: new RegExp(`^${handle}@`, "i") })),
      }).lean();
      mentionUserIds = found.map((u) => u._id);
    }

    const id = prefixedId("cmt");
    await TaskComment.create({
      _id: id,
      taskId: t._id,
      authorId: req.user!.id,
      body: body.body,
      mentions: mentionUserIds,
    });

    for (const uid of mentionUserIds) {
      if (uid === req.user!.id) continue;
      await Notification.create({
        _id: prefixedId("ntf"),
        userId: uid,
        workspaceId: req.workspaceId!,
        projectId: t.projectId,
        kind: "mention",
        title: `${req.user!.name} mentioned you`,
        body: body.body.slice(0, 200),
        targetType: "task",
        targetId: t._id,
        actorId: req.user!.id,
      });
    }
    await logActivity({
      workspaceId: req.workspaceId!,
      projectId: t.projectId,
      actorId: req.user!.id,
      action: "commented",
      targetType: "task",
      targetId: t._id,
      targetLabel: t.title,
    });

    return ok(
      res,
      {
        comment: {
          id,
          body: body.body,
          mentions: mentionUserIds,
          author: publicUser({
            _id: req.user!.id,
            email: req.user!.email,
            name: req.user!.name,
            avatarColor: req.user!.avatarColor,
          }),
          createdAt: new Date(),
        },
      },
      201,
    );
  }),
);

// ---------- Attachments ----------

taskRoutes.get(
  "/tasks/:id/attachments",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const t = await Task.findById(req.params.id).lean();
    if (!t) return fail(res, 404, "Task not found");
    const access = await ensureProjectAccess(req.user!.id, t.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const rows = await TaskAttachment.find({ taskId: t._id }).sort({ createdAt: -1 }).lean();
    return ok(res, {
      attachments: rows.map((r) => ({
        id: r._id,
        url: r.url,
        name: r.name,
        size: r.size,
        mime: r.mime,
        createdAt: r.createdAt,
      })),
    });
  }),
);

taskRoutes.post(
  "/tasks/:id/attachments",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const t = await Task.findById(req.params.id).lean();
    if (!t) return fail(res, 404, "Task not found");
    const access = await ensureProjectAccess(req.user!.id, t.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const schema = z.object({
      url: z.string().url().max(2048),
      name: z.string().max(256).optional(),
      size: z.number().int().nonnegative().optional(),
      mime: z.string().max(120).optional(),
    });
    const body = schema.parse(req.body);
    const id = prefixedId("att");
    await TaskAttachment.create({
      _id: id,
      taskId: t._id,
      url: body.url,
      name: body.name ?? body.url.split("/").pop() ?? "attachment",
      size: body.size ?? 0,
      mime: body.mime ?? "",
      uploadedById: req.user!.id,
    });
    return ok(res, { id }, 201);
  }),
);

taskRoutes.delete(
  "/attachments/:id",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const a = await TaskAttachment.findById(req.params.id).lean();
    if (!a) return fail(res, 404, "Attachment not found");
    const t = await Task.findById(a.taskId).lean();
    if (!t) return fail(res, 404, "Task missing");
    const access = await ensureProjectAccess(req.user!.id, t.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    await TaskAttachment.deleteOne({ _id: a._id });
    return ok(res, { ok: true });
  }),
);
