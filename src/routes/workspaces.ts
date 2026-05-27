import { Router, type Response } from "express";
import { type AuthedRequest, requireUser } from "../auth.js";
import { Project, Task, User, Workspace, WorkspaceMember } from "../models.js";
import { publicProject, publicUser, publicWorkspace } from "../serialize.js";
import { asyncH, withWorkspace } from "../middleware.js";
import { ok, fail } from "../util.js";

export const workspaceRoutes = Router();

workspaceRoutes.get(
  "/workspaces",
  requireUser,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const members = await WorkspaceMember.find({ userId: req.user!.id }).lean();
    if (!members.length) return ok(res, { workspaces: [], active: null });
    const wsIds = members.map((m) => m.workspaceId);
    const all = await Workspace.find({ _id: { $in: wsIds } })
      .sort({ createdAt: 1 })
      .lean();
    return ok(res, { workspaces: all.map(publicWorkspace), active: all[0] ? publicWorkspace(all[0]) : null });
  }),
);

workspaceRoutes.get(
  "/workspace/summary",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const wsId = req.workspaceId!;
    const ws = await Workspace.findById(wsId).lean();
    if (!ws) return fail(res, 404, "Workspace missing");

    const [projectsList, membersList, projectCount] = await Promise.all([
      Project.find({ workspaceId: wsId, archived: { $ne: true } })
        .sort({ createdAt: 1 })
        .lean(),
      WorkspaceMember.find({ workspaceId: wsId }).lean(),
      Project.countDocuments({ workspaceId: wsId, archived: { $ne: true } }),
    ]);
    const memberUserIds = membersList.map((m) => m.userId);
    const memberUsers = await User.find({ _id: { $in: memberUserIds } }).lean();
    const userMap = new Map(memberUsers.map((u) => [u._id, u]));
    const projectIds = projectsList.map((p) => p._id);
    const taskCounts = await Task.aggregate<{ _id: string; total: number; done: number }>([
      { $match: { projectId: { $in: projectIds } } },
      {
        $group: {
          _id: "$projectId",
          total: { $sum: 1 },
          done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
        },
      },
    ]);
    const taskMap = new Map(taskCounts.map((t) => [t._id, t]));

    return ok(res, {
      workspace: publicWorkspace(ws),
      tier: ws.tier ?? "free",
      counts: {
        projects: projectCount,
        members: membersList.length,
      },
      projects: projectsList.map((p) => ({
        ...publicProject(p),
        taskCount: taskMap.get(p._id)?.total ?? 0,
        doneCount: taskMap.get(p._id)?.done ?? 0,
      })),
      members: membersList.map((m) => ({
        role: m.role,
        joinedAt: m.createdAt,
        user: userMap.get(m.userId) ? publicUser(userMap.get(m.userId)!) : null,
      })),
    });
  }),
);
