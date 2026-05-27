import { Integration, IntegrationLink, Project } from "../models.js";

/**
 * Outbound Slack notification — posts to all Slack channels linked to a project.
 * Safe to call from anywhere; silently no-ops if no Slack integration is configured.
 */
export async function postSlackForProject(projectId: string, text: string): Promise<void> {
  const proj = await Project.findById(projectId).lean();
  if (!proj) return;

  const integration = await Integration.findOne({
    workspaceId: proj.workspaceId,
    kind: "slack",
  }).lean();
  if (!integration) return;

  const links = await IntegrationLink.find({
    integrationId: integration._id,
    projectId,
  }).lean();

  for (const link of links) {
    const channel = link.externalId;
    const webhook = integration.webhookUrl;

    if (webhook) {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      }).catch(() => {});
      continue;
    }
    if (integration.accessToken) {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${integration.accessToken}`,
        },
        body: JSON.stringify({ channel, text }),
      }).catch(() => {});
    }
  }
}

/**
 * Lightweight ingestion of GitHub webhook events into the activity feed.
 */
export async function ingestGithubEvent(
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { Activity } = await import("../models.js");
  const { prefixedId } = await import("../ids.js");

  let action = "github_event";
  let label = "";
  if (event === "push") {
    const commits = (payload.commits as Array<{ message?: string }>) ?? [];
    const repo = (payload.repository as { full_name?: string } | undefined)?.full_name ?? "";
    action = "github_push";
    label = `${commits.length} commit(s) to ${repo}`;
  } else if (event === "pull_request") {
    const pr = payload.pull_request as { title?: string; number?: number } | undefined;
    action = `github_pr_${(payload.action as string) ?? "updated"}`;
    label = `PR #${pr?.number ?? "?"}: ${pr?.title ?? ""}`;
  } else if (event === "issues") {
    const issue = payload.issue as { title?: string; number?: number } | undefined;
    action = `github_issue_${(payload.action as string) ?? "updated"}`;
    label = `Issue #${issue?.number ?? "?"}: ${issue?.title ?? ""}`;
  }

  await Activity.create({
    _id: prefixedId("act"),
    workspaceId,
    actorId: null,
    action,
    targetType: "github",
    targetId: String((payload.repository as { id?: number } | undefined)?.id ?? ""),
    targetLabel: label || event,
    meta: { event, repository: (payload.repository as { full_name?: string } | undefined)?.full_name },
  });
}
