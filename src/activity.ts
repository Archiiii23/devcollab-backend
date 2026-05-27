import { Activity } from "./models.js";
import { prefixedId } from "./ids.js";

export async function logActivity(opts: {
  workspaceId: string;
  projectId?: string | null;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel?: string;
  meta?: unknown;
}): Promise<void> {
  await Activity.create({
    _id: prefixedId("act"),
    workspaceId: opts.workspaceId,
    projectId: opts.projectId ?? null,
    actorId: opts.actorId,
    action: opts.action,
    targetType: opts.targetType,
    targetId: opts.targetId,
    targetLabel: opts.targetLabel ?? "",
    meta: opts.meta ?? null,
  });
}
