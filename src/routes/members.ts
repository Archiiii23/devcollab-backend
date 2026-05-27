import { Router, type Response } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { type AuthedRequest, requireUser } from "../auth.js";
import { User, Workspace, WorkspaceInvite, WorkspaceMember } from "../models.js";
import { publicUser } from "../serialize.js";
import { asyncH, ensureRole, withWorkspace } from "../middleware.js";
import { prefixedId } from "../ids.js";
import { ok, fail } from "../util.js";
import { logActivity } from "../activity.js";
import { FREE_LIMITS } from "../workspace.js";

export const memberRoutes = Router();

memberRoutes.get(
  "/workspace/members",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    const members = await WorkspaceMember.find({ workspaceId: wsId }).sort({ createdAt: 1 }).lean();
    const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).lean();
    const userMap = new Map(users.map((u) => [u._id, u]));
    return ok(res, {
      members: members
        .map((m) => ({
          role: m.role,
          joinedAt: m.createdAt,
          user: userMap.get(m.userId) ? publicUser(userMap.get(m.userId)!) : null,
        }))
        .filter((m) => m.user),
    });
  }),
);

const updateRoleSchema = z.object({ role: z.enum(["owner", "admin", "member", "viewer"]) });

memberRoutes.patch(
  "/workspace/members/:userId",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    if (!(await ensureRole(wsId, req.user!.id, "admin"))) return fail(res, 403, "Admin required");
    const body = updateRoleSchema.parse(req.body);
    const target = await WorkspaceMember.findOne({ workspaceId: wsId, userId: req.params.userId });
    if (!target) return fail(res, 404, "Member not found");
    if (target.role === "owner") return fail(res, 403, "Cannot change owner role");
    target.role = body.role;
    await target.save();
    return ok(res, { ok: true });
  }),
);

memberRoutes.delete(
  "/workspace/members/:userId",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    if (!(await ensureRole(wsId, req.user!.id, "admin"))) return fail(res, 403, "Admin required");
    const target = await WorkspaceMember.findOne({ workspaceId: wsId, userId: req.params.userId });
    if (!target) return fail(res, 404, "Member not found");
    if (target.role === "owner") return fail(res, 403, "Cannot remove owner");
    await WorkspaceMember.deleteOne({ _id: target._id });
    return ok(res, { ok: true });
  }),
);

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});

memberRoutes.get(
  "/workspace/invites",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const invites = await WorkspaceInvite.find({
      workspaceId: req.workspaceId!,
      acceptedAt: null,
    })
      .sort({ createdAt: -1 })
      .lean();
    return ok(res, {
      invites: invites.map((i) => ({
        id: i._id,
        email: i.email,
        role: i.role,
        token: i.token,
        invitedBy: i.invitedById,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
    });
  }),
);

memberRoutes.post(
  "/workspace/invites",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    if (!(await ensureRole(wsId, req.user!.id, "admin"))) return fail(res, 403, "Admin required");

    const ws = await Workspace.findById(wsId).lean();
    const memberCount = await WorkspaceMember.countDocuments({ workspaceId: wsId });
    const pendingCount = await WorkspaceInvite.countDocuments({
      workspaceId: wsId,
      acceptedAt: null,
    });
    if (ws?.tier === "free" && memberCount + pendingCount >= FREE_LIMITS.members) {
      return fail(res, 402, `Free tier limited to ${FREE_LIMITS.members} members. Upgrade to invite more.`);
    }

    const body = inviteSchema.parse(req.body);
    const token = randomBytes(18).toString("base64url");
    const invite = await WorkspaceInvite.create({
      _id: prefixedId("inv"),
      workspaceId: wsId,
      email: body.email.toLowerCase(),
      role: body.role,
      token,
      invitedById: req.user!.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
    });
    await logActivity({
      workspaceId: wsId,
      actorId: req.user!.id,
      action: "invited",
      targetType: "invite",
      targetId: invite._id,
      targetLabel: body.email,
    });
    return ok(res, { id: invite._id, token, email: body.email, role: body.role }, 201);
  }),
);

memberRoutes.delete(
  "/workspace/invites/:id",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    if (!(await ensureRole(wsId, req.user!.id, "admin"))) return fail(res, 403, "Admin required");
    await WorkspaceInvite.deleteOne({ _id: req.params.id, workspaceId: wsId });
    return ok(res, { ok: true });
  }),
);

memberRoutes.post(
  "/invites/accept",
  requireUser,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const schema = z.object({ token: z.string().min(8) });
    const body = schema.parse(req.body);
    const invite = await WorkspaceInvite.findOne({ token: body.token, acceptedAt: null });
    if (!invite) return fail(res, 404, "Invite not found or already used.");
    if (new Date(invite.expiresAt) < new Date()) return fail(res, 410, "Invite expired.");
    await WorkspaceMember.updateOne(
      { workspaceId: invite.workspaceId, userId: req.user!.id },
      {
        $setOnInsert: { workspaceId: invite.workspaceId, userId: req.user!.id, role: invite.role },
      },
      { upsert: true },
    );
    invite.acceptedAt = new Date();
    await invite.save();
    return ok(res, { workspaceId: invite.workspaceId, role: invite.role });
  }),
);
