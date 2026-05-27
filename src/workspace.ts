import { Project, Workspace, WorkspaceMember } from "./models.js";

export async function getActiveWorkspaceId(userId: string): Promise<string | null> {
  const member = await WorkspaceMember.findOne({ userId }).sort({ createdAt: 1 }).lean();
  return member?.workspaceId ?? null;
}

export async function getMemberRole(
  workspaceId: string,
  userId: string,
): Promise<"owner" | "admin" | "member" | "viewer" | null> {
  const m = await WorkspaceMember.findOne({ workspaceId, userId }).lean();
  return (m?.role as "owner" | "admin" | "member" | "viewer" | undefined) ?? null;
}

const ROLE_ORDER = { viewer: 0, member: 1, admin: 2, owner: 3 } as const;
type Role = keyof typeof ROLE_ORDER;

export function roleAtLeast(actual: Role | null | undefined, required: Role): boolean {
  if (!actual) return false;
  return ROLE_ORDER[actual] >= ROLE_ORDER[required];
}

export async function ensureProjectAccess(userId: string, projectId: string) {
  const proj = await Project.findById(projectId).lean();
  if (!proj) return null;
  const role = await getMemberRole(proj.workspaceId, userId);
  if (!role) return null;
  return { project: proj, role };
}

export async function projectByIdOrSlug(workspaceId: string, idOrSlug: string) {
  const byId = await Project.findOne({ _id: idOrSlug, workspaceId }).lean();
  if (byId) return byId;
  const bySlug = await Project.findOne({ slug: idOrSlug, workspaceId }).lean();
  return bySlug;
}

export async function getWorkspaceTier(workspaceId: string) {
  const ws = await Workspace.findById(workspaceId).lean();
  return ws?.tier ?? "free";
}

export const FREE_LIMITS = { projects: 3, members: 5 } as const;
