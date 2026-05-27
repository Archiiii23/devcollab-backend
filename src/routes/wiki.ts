import { Router, type Response } from "express";
import { z } from "zod";
import { type AuthedRequest, requireUser } from "../auth.js";
import { User, WikiPage, WikiVersion } from "../models.js";
import { publicUser, publicWikiPage } from "../serialize.js";
import { asyncH, withWorkspace } from "../middleware.js";
import { prefixedId, slugify } from "../ids.js";
import { ok, fail } from "../util.js";
import { logActivity } from "../activity.js";
import { ensureProjectAccess, projectByIdOrSlug } from "../workspace.js";

export const wikiRoutes = Router();

wikiRoutes.get(
  "/projects/:idOrSlug/wiki",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const proj = await projectByIdOrSlug(req.workspaceId!, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");
    const rows = await WikiPage.find({ projectId: proj._id }).sort({ createdAt: -1 }).lean();
    const authors = await User.find({ _id: { $in: rows.map((r) => r.authorId) } }).lean();
    const map = new Map(authors.map((u) => [u._id, publicUser(u)]));
    return ok(res, {
      pages: rows.map((p) =>
        publicWikiPage(p, map.get(p.authorId) ?? { id: p.authorId, email: "", name: "Unknown", avatarColor: "", avatarUrl: null, initials: "??" }),
      ),
    });
  }),
);

const createSchema = z.object({
  title: z.string().min(1).max(140),
  content: z.string().max(60000).optional(),
  category: z.string().max(60).optional(),
});

wikiRoutes.post(
  "/projects/:idOrSlug/wiki",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const proj = await projectByIdOrSlug(req.workspaceId!, req.params.idOrSlug);
    if (!proj) return fail(res, 404, "Project not found");
    const body = createSchema.parse(req.body);
    let slug = slugify(body.title);
    while (await WikiPage.findOne({ projectId: proj._id, slug }).lean()) {
      slug = `${slugify(body.title)}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const id = prefixedId("wik");
    const doc = await WikiPage.create({
      _id: id,
      projectId: proj._id,
      title: body.title.trim(),
      slug,
      content: body.content ?? "",
      category: body.category ?? "General",
      authorId: req.user!.id,
    });
    await logActivity({
      workspaceId: req.workspaceId!,
      projectId: proj._id,
      actorId: req.user!.id,
      action: "created",
      targetType: "wiki",
      targetId: id,
      targetLabel: doc.title,
    });
    return ok(
      res,
      {
        page: publicWikiPage(doc.toObject(), publicUser({ _id: req.user!.id, email: req.user!.email, name: req.user!.name, avatarColor: req.user!.avatarColor })),
      },
      201,
    );
  }),
);

const updateSchema = createSchema.partial();

wikiRoutes.patch(
  "/wiki/:id",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const p = await WikiPage.findById(req.params.id);
    if (!p) return fail(res, 404, "Wiki page not found");
    const access = await ensureProjectAccess(req.user!.id, p.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const body = updateSchema.parse(req.body);

    // Snapshot current version before saving
    await WikiVersion.create({
      _id: prefixedId("wiv"),
      pageId: p._id,
      title: p.title,
      content: p.content,
      category: p.category,
      authorId: p.authorId,
    });

    if (body.title !== undefined) p.title = body.title.trim();
    if (body.content !== undefined) p.content = body.content;
    if (body.category !== undefined) p.category = body.category;
    await p.save();
    await logActivity({
      workspaceId: req.workspaceId!,
      projectId: p.projectId,
      actorId: req.user!.id,
      action: "updated",
      targetType: "wiki",
      targetId: p._id,
      targetLabel: p.title,
    });

    const author = await User.findById(p.authorId).lean();
    return ok(res, {
      page: publicWikiPage(
        p.toObject(),
        author
          ? publicUser(author)
          : { id: p.authorId, email: "", name: "Unknown", avatarColor: "", avatarUrl: null, initials: "??" },
      ),
    });
  }),
);

wikiRoutes.delete(
  "/wiki/:id",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const p = await WikiPage.findById(req.params.id).lean();
    if (!p) return fail(res, 404, "Wiki page not found");
    const access = await ensureProjectAccess(req.user!.id, p.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    await WikiPage.deleteOne({ _id: p._id });
    await WikiVersion.deleteMany({ pageId: p._id });
    return ok(res, { ok: true });
  }),
);

wikiRoutes.get(
  "/wiki/:id/versions",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const p = await WikiPage.findById(req.params.id).lean();
    if (!p) return fail(res, 404, "Wiki page not found");
    const access = await ensureProjectAccess(req.user!.id, p.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const versions = await WikiVersion.find({ pageId: p._id }).sort({ createdAt: -1 }).lean();
    return ok(res, {
      versions: versions.map((v) => ({
        id: v._id,
        title: v.title,
        content: v.content,
        category: v.category,
        authorId: v.authorId,
        createdAt: v.createdAt,
      })),
    });
  }),
);

wikiRoutes.post(
  "/wiki/:id/revert/:versionId",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const p = await WikiPage.findById(req.params.id);
    if (!p) return fail(res, 404, "Wiki page not found");
    const access = await ensureProjectAccess(req.user!.id, p.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const v = await WikiVersion.findOne({ _id: req.params.versionId, pageId: p._id }).lean();
    if (!v) return fail(res, 404, "Version not found");

    // Snapshot current before reverting
    await WikiVersion.create({
      _id: prefixedId("wiv"),
      pageId: p._id,
      title: p.title,
      content: p.content,
      category: p.category,
      authorId: p.authorId,
    });
    p.title = v.title;
    p.content = v.content;
    p.category = v.category;
    await p.save();
    return ok(res, { ok: true });
  }),
);
