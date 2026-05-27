import { Router, type Response } from "express";
import { z } from "zod";
import {
  type AuthedRequest,
  clearSessionCookie,
  createSession,
  deleteSession,
  hashPassword,
  initialsFromName,
  newUserId,
  pickColor,
  readSessionCookie,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";
import { User, Workspace, WorkspaceMember } from "../models.js";
import { prefixedId, slugify } from "../ids.js";
import { publicUser, publicUserFull } from "../serialize.js";
import { asyncH } from "../middleware.js";
import { ok, fail } from "../util.js";
import { seedIfEmpty, ensureDemoUser } from "../seed.js";

export const authRoutes = Router();

authRoutes.post(
  "/auth/bootstrap",
  asyncH(async (_req: AuthedRequest, res: Response) => {
    const seed = await seedIfEmpty();
    const demo = await ensureDemoUser();
    return ok(res, { ...seed, demo });
  }),
);

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(80),
});

authRoutes.post(
  "/auth/signup",
  asyncH(async (req: AuthedRequest, res: Response) => {
    await seedIfEmpty().catch(() => {});
    const body = signupSchema.parse(req.body);

    const existing = await User.findOne({ email: body.email.toLowerCase() }).lean();
    if (existing) return fail(res, 409, "An account with that email already exists.");

    const userId = newUserId();
    const passwordHash = await hashPassword(body.password);
    await User.create({
      _id: userId,
      email: body.email.toLowerCase(),
      name: body.name.trim(),
      passwordHash,
      avatarColor: pickColor(body.email),
    });

    // Add new user to the demo workspace so they see content
    const fallbackWs = await Workspace.findOne().lean();
    if (fallbackWs) {
      await WorkspaceMember.updateOne(
        { workspaceId: fallbackWs._id, userId },
        { $setOnInsert: { workspaceId: fallbackWs._id, userId, role: "member" } },
        { upsert: true },
      );
    } else {
      const newWsId = prefixedId("ws");
      await Workspace.create({
        _id: newWsId,
        name: `${body.name.split(" ")[0]}'s workspace`,
        slug: `${slugify(body.name)}-${prefixedId("w", 4).slice(2)}`,
        ownerId: userId,
      });
      await WorkspaceMember.create({ workspaceId: newWsId, userId, role: "owner" });
    }

    const session = await createSession(userId);
    setSessionCookie(req, res, session.id);
    return ok(res, { user: { ...publicUser({ _id: userId, email: body.email.toLowerCase(), name: body.name.trim(), avatarColor: pickColor(body.email) }) } }, 201);
  }),
);

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRoutes.post(
  "/auth/login",
  asyncH(async (req: AuthedRequest, res: Response) => {
    await seedIfEmpty().catch(() => {});
    await ensureDemoUser().catch(() => {});
    const body = loginSchema.parse(req.body);
    const row = await User.findOne({ email: body.email.toLowerCase() }).lean();
    if (!row) return fail(res, 401, "Invalid email or password.");
    const valid = await verifyPassword(body.password, row.passwordHash);
    if (!valid) return fail(res, 401, "Invalid email or password.");
    const session = await createSession(row._id);
    setSessionCookie(req, res, session.id);
    return ok(res, { user: publicUser(row) });
  }),
);

authRoutes.post(
  "/auth/logout",
  asyncH(async (req: AuthedRequest, res: Response) => {
    const sid = readSessionCookie(req);
    if (sid) await deleteSession(sid);
    clearSessionCookie(req, res);
    return ok(res, { ok: true });
  }),
);

authRoutes.get(
  "/auth/me",
  asyncH(async (req: AuthedRequest, res: Response) => {
    if (!req.user) return ok(res, { user: null });
    const u = await User.findById(req.user.id).lean();
    if (!u) return ok(res, { user: null });
    return ok(res, { user: publicUser(u) });
  }),
);

authRoutes.get(
  "/auth/me/full",
  requireUser,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const u = await User.findById(req.user!.id).lean();
    if (!u) return fail(res, 404, "Not found");
    return ok(res, { user: publicUserFull(u) });
  }),
);

const profileSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().max(1024).optional(),
  githubUrl: z.string().max(256).optional(),
  skills: z.array(z.string().min(1).max(40)).max(20).optional(),
});

authRoutes.patch(
  "/auth/profile",
  requireUser,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const body = profileSchema.parse(req.body);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name.trim();
    if (body.bio !== undefined) update.bio = body.bio;
    if (body.avatarUrl !== undefined) update.avatarUrl = body.avatarUrl;
    if (body.githubUrl !== undefined) update.githubUrl = body.githubUrl;
    if (body.skills !== undefined) update.skills = body.skills;
    if (Object.keys(update).length) {
      await User.updateOne({ _id: req.user!.id }, { $set: update });
    }
    const fresh = await User.findById(req.user!.id).lean();
    if (!fresh) return fail(res, 404, "Not found");
    return ok(res, { user: publicUserFull(fresh) });
  }),
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(120),
});

authRoutes.post(
  "/auth/password",
  requireUser,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const body = passwordSchema.parse(req.body);
    const u = await User.findById(req.user!.id);
    if (!u) return fail(res, 404, "Not found");
    const ok2 = await verifyPassword(body.currentPassword, u.passwordHash);
    if (!ok2) return fail(res, 401, "Current password is incorrect.");
    u.passwordHash = await hashPassword(body.newPassword);
    await u.save();
    return ok(res, { ok: true });
  }),
);

// Make publicUser-from-name a no-op for typing
void initialsFromName;
