import { Router, type Response } from "express";
import { z } from "zod";
import { type AuthedRequest, requireUser } from "../auth.js";
import { Snippet, User } from "../models.js";
import { publicSnippet, publicUser } from "../serialize.js";
import { asyncH, withWorkspace } from "../middleware.js";
import { prefixedId } from "../ids.js";
import { ok, fail } from "../util.js";
import { logActivity } from "../activity.js";
import { ensureProjectAccess, projectByIdOrSlug } from "../workspace.js";

export const snippetRoutes = Router();

snippetRoutes.get(
  "/projects/:idOrSlug/snippets",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const proj = await projectByIdOrSlug(req.workspaceId!, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");
    const rows = await Snippet.find({ projectId: proj._id }).sort({ createdAt: -1 }).lean();
    const authors = await User.find({ _id: { $in: rows.map((r) => r.authorId) } }).lean();
    const map = new Map(authors.map((u) => [u._id, publicUser(u)]));
    return ok(res, {
      snippets: rows.map((s) =>
        publicSnippet(
          s,
          map.get(s.authorId) ?? { id: s.authorId, email: "", name: "Unknown", avatarColor: "", avatarUrl: null, initials: "??" },
        ),
      ),
    });
  }),
);

const createSchema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().max(500).optional(),
  language: z.string().max(40).optional(),
  code: z.string().min(1).max(20000),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

snippetRoutes.post(
  "/projects/:idOrSlug/snippets",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const proj = await projectByIdOrSlug(req.workspaceId!, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");
    const body = createSchema.parse(req.body);
    const id = prefixedId("snp");
    const doc = await Snippet.create({
      _id: id,
      projectId: proj._id,
      title: body.title.trim(),
      description: body.description ?? "",
      language: body.language ?? "ts",
      code: body.code,
      authorId: req.user!.id,
      tags: body.tags ?? [],
    });
    await logActivity({
      workspaceId: req.workspaceId!,
      projectId: proj._id,
      actorId: req.user!.id,
      action: "created",
      targetType: "snippet",
      targetId: id,
      targetLabel: body.title,
    });
    return ok(
      res,
      {
        snippet: publicSnippet(
          doc.toObject(),
          publicUser({ _id: req.user!.id, email: req.user!.email, name: req.user!.name, avatarColor: req.user!.avatarColor }),
        ),
      },
      201,
    );
  }),
);

const updateSchema = createSchema.partial();

snippetRoutes.patch(
  "/snippets/:id",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const s = await Snippet.findById(req.params.id);
    if (!s) return fail(res, 404, "Snippet not found");
    const access = await ensureProjectAccess(req.user!.id, s.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const body = updateSchema.parse(req.body);
    if (body.title !== undefined) s.title = body.title.trim();
    if (body.description !== undefined) s.description = body.description;
    if (body.language !== undefined) s.language = body.language;
    if (body.code !== undefined) s.code = body.code;
    if (body.tags !== undefined) s.tags = body.tags as never;
    await s.save();
    const author = await User.findById(s.authorId).lean();
    return ok(res, {
      snippet: publicSnippet(
        s.toObject(),
        author ? publicUser(author) : { id: s.authorId, email: "", name: "Unknown", avatarColor: "", avatarUrl: null, initials: "??" },
      ),
    });
  }),
);

snippetRoutes.delete(
  "/snippets/:id",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const s = await Snippet.findById(req.params.id).lean();
    if (!s) return fail(res, 404, "Snippet not found");
    const access = await ensureProjectAccess(req.user!.id, s.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    await Snippet.deleteOne({ _id: s._id });
    return ok(res, { ok: true });
  }),
);
