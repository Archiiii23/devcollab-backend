import { Router, type Response, type Request } from "express";
import { z } from "zod";
import { type AuthedRequest, requireUser } from "../auth.js";
import { Integration, IntegrationLink, OAuthState, WikiPage } from "../models.js";
import { asyncH, withWorkspace } from "../middleware.js";
import { prefixedId, nanoid, slugify } from "../ids.js";
import { ok, fail } from "../util.js";
import { ensureProjectAccess } from "../workspace.js";

export const integrationRoutes = Router();

// ---------- helpers ----------

function appBaseUrl(req: Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  return `${proto}://${host}`;
}
function frontendBaseUrl(req: Request): string {
  if (process.env.FRONTEND_BASE_URL) return process.env.FRONTEND_BASE_URL.replace(/\/$/, "");
  const origin = req.headers.origin as string | undefined;
  if (origin) return origin;
  return "https://hackathon-round.vercel.app";
}

async function createOauthState(opts: {
  userId: string;
  workspaceId: string;
  kind: string;
  returnTo: string;
}): Promise<string> {
  const id = `oas_${nanoid(24)}`;
  await OAuthState.create({
    _id: id,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    kind: opts.kind,
    returnTo: opts.returnTo,
    expiresAt: new Date(Date.now() + 1000 * 60 * 10),
  });
  return id;
}

async function consumeOauthState(id: string, kind: string) {
  const row = await OAuthState.findOne({ _id: id, kind }).lean();
  if (!row) return null;
  await OAuthState.deleteOne({ _id: id });
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;
  return row;
}

function publicIntegration(i: {
  _id: string;
  kind: string;
  accountId: string;
  accountName: string;
  accountAvatar: string;
  webhookUrl?: string;
  meta?: unknown;
  createdAt?: Date | string | number;
}) {
  return {
    id: i._id,
    kind: i.kind,
    accountId: i.accountId,
    accountName: i.accountName,
    accountAvatar: i.accountAvatar,
    hasWebhook: Boolean(i.webhookUrl),
    meta: i.meta ?? {},
    createdAt: i.createdAt,
  };
}

async function upsertIntegration(opts: {
  workspaceId: string;
  kind: "github" | "slack" | "notion";
  accessToken: string;
  refreshToken?: string | null;
  scope?: string;
  accountId?: string;
  accountName?: string;
  accountAvatar?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  meta?: unknown;
  connectedById: string;
}) {
  const existing = await Integration.findOne({
    workspaceId: opts.workspaceId,
    kind: opts.kind,
  });
  if (existing) {
    existing.accessToken = opts.accessToken;
    existing.refreshToken = opts.refreshToken ?? null;
    existing.scope = opts.scope ?? "";
    existing.accountId = opts.accountId ?? "";
    existing.accountName = opts.accountName ?? "";
    existing.accountAvatar = opts.accountAvatar ?? "";
    if (opts.webhookUrl !== undefined) existing.webhookUrl = opts.webhookUrl;
    if (opts.webhookSecret !== undefined) existing.webhookSecret = opts.webhookSecret;
    if (opts.meta !== undefined) existing.meta = opts.meta as never;
    await existing.save();
    return existing;
  }
  return Integration.create({
    _id: prefixedId("int"),
    workspaceId: opts.workspaceId,
    kind: opts.kind,
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken ?? null,
    scope: opts.scope ?? "",
    accountId: opts.accountId ?? "",
    accountName: opts.accountName ?? "",
    accountAvatar: opts.accountAvatar ?? "",
    webhookUrl: opts.webhookUrl ?? "",
    webhookSecret: opts.webhookSecret ?? "",
    meta: opts.meta ?? {},
    connectedById: opts.connectedById,
  });
}

// ---------- list / disconnect ----------

integrationRoutes.get(
  "/integrations",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const rows = await Integration.find({ workspaceId: req.workspaceId! }).lean();
    return ok(res, {
      integrations: rows.map(publicIntegration),
      config: {
        github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
        slack: Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
        notion: Boolean(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET),
      },
    });
  }),
);

integrationRoutes.delete(
  "/integrations/:id",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const i = await Integration.findOne({ _id: req.params.id, workspaceId: req.workspaceId! });
    if (!i) return fail(res, 404, "Integration not found");
    await Integration.deleteOne({ _id: i._id });
    await IntegrationLink.deleteMany({ integrationId: i._id });
    return ok(res, { ok: true });
  }),
);

// ---------- per-project links ----------

integrationRoutes.get(
  "/integrations/links/:projectId",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const access = await ensureProjectAccess(req.user!.id, req.params.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const links = await IntegrationLink.find({ projectId: req.params.projectId }).lean();
    const integrationIds = Array.from(new Set(links.map((l) => l.integrationId)));
    const ints = integrationIds.length
      ? await Integration.find({ _id: { $in: integrationIds } }).lean()
      : [];
    const map = new Map(ints.map((i) => [i._id, i]));
    return ok(res, {
      links: links.map((l) => ({
        id: l._id,
        projectId: l.projectId,
        externalId: l.externalId,
        externalName: l.externalName,
        externalUrl: l.externalUrl,
        kind: map.get(l.integrationId)?.kind,
        accountName: map.get(l.integrationId)?.accountName,
        createdAt: l.createdAt,
      })),
    });
  }),
);

integrationRoutes.delete(
  "/integrations/links/:id",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const link = await IntegrationLink.findById(req.params.id).lean();
    if (!link) return fail(res, 404, "Not found");
    const access = await ensureProjectAccess(req.user!.id, link.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    await IntegrationLink.deleteOne({ _id: link._id });
    return ok(res, { ok: true });
  }),
);

// ============================================================
// GITHUB
// ============================================================

integrationRoutes.get(
  "/integrations/github/start",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    if (!process.env.GITHUB_CLIENT_ID) return fail(res, 400, "GitHub not configured");
    const stateId = await createOauthState({
      userId: req.user!.id,
      workspaceId: req.workspaceId!,
      kind: "github",
      returnTo: String(req.query.returnTo ?? "/app/integrations"),
    });
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID,
      redirect_uri: `${appBaseUrl(req)}/integrations/github/callback`,
      scope: "repo read:user user:email admin:repo_hook",
      state: stateId,
    });
    return ok(res, { url: `https://github.com/login/oauth/authorize?${params.toString()}` });
  }),
);

integrationRoutes.get(
  "/integrations/github/callback",
  asyncH(async (req: Request, res: Response) => {
    const code = String(req.query.code ?? "");
    const stateId = String(req.query.state ?? "");
    if (!code || !stateId) return fail(res, 400, "Missing code/state");
    const state = await consumeOauthState(stateId, "github");
    if (!state) return fail(res, 400, "Invalid or expired state");
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET)
      return fail(res, 500, "GitHub not configured");

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${appBaseUrl(req)}/integrations/github/callback`,
      }),
    });
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as Record<string, string>;
    const accessToken = tokenJson.access_token;
    if (!accessToken) return fail(res, 401, "GitHub did not return an access token");

    const userRes = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${accessToken}`, "user-agent": "DevCollab" },
    });
    const ghUser = (await userRes.json().catch(() => ({}))) as Record<string, unknown>;

    await upsertIntegration({
      workspaceId: state.workspaceId,
      kind: "github",
      accessToken,
      scope: tokenJson.scope ?? "",
      accountId: String(ghUser.login ?? ""),
      accountName: String(ghUser.name ?? ghUser.login ?? ""),
      accountAvatar: String(ghUser.avatar_url ?? ""),
      meta: { id: ghUser.id, html_url: ghUser.html_url },
      connectedById: state.userId,
    });
    res.redirect(`${frontendBaseUrl(req)}${state.returnTo || "/app/integrations"}?integration=github&status=ok`);
  }),
);

integrationRoutes.get(
  "/integrations/github/repos",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const integration = await Integration.findOne({
      workspaceId: req.workspaceId!,
      kind: "github",
    }).lean();
    if (!integration) return fail(res, 404, "GitHub not connected");
    const list = await fetch(
      "https://api.github.com/user/repos?per_page=100&sort=updated",
      {
        headers: { authorization: `Bearer ${integration.accessToken}`, "user-agent": "DevCollab" },
      },
    );
    if (!list.ok) return fail(res, list.status, "GitHub API error");
    const arr = (await list.json()) as Array<Record<string, unknown>>;
    return ok(res, {
      repos: arr.map((r) => ({
        id: String(r.id),
        fullName: String(r.full_name),
        name: String(r.name),
        private: Boolean(r.private),
        url: String(r.html_url),
      })),
    });
  }),
);

integrationRoutes.post(
  "/integrations/github/link",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const schema = z.object({
      projectId: z.string(),
      fullName: z.string(),
      installWebhook: z.boolean().optional(),
    });
    const body = schema.parse(req.body);
    const access = await ensureProjectAccess(req.user!.id, body.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const integration = await Integration.findOne({
      workspaceId: req.workspaceId!,
      kind: "github",
    });
    if (!integration) return fail(res, 404, "GitHub not connected");

    if (body.installWebhook && process.env.GITHUB_WEBHOOK_SECRET) {
      await fetch(`https://api.github.com/repos/${body.fullName}/hooks`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${integration.accessToken}`,
          "user-agent": "DevCollab",
          accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          name: "web",
          active: true,
          events: ["push", "pull_request", "issues"],
          config: {
            url: `${appBaseUrl(req)}/webhooks/github`,
            content_type: "json",
            secret: process.env.GITHUB_WEBHOOK_SECRET,
            insecure_ssl: "0",
          },
        }),
      }).catch(() => {});
    }

    await IntegrationLink.updateOne(
      {
        integrationId: integration._id,
        projectId: body.projectId,
        externalId: body.fullName,
      },
      {
        $setOnInsert: {
          _id: prefixedId("lnk"),
          integrationId: integration._id,
          projectId: body.projectId,
          externalId: body.fullName,
          externalName: body.fullName,
          externalUrl: `https://github.com/${body.fullName}`,
        },
      },
      { upsert: true },
    );
    return ok(res, { ok: true });
  }),
);

// ============================================================
// SLACK
// ============================================================

integrationRoutes.get(
  "/integrations/slack/start",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    if (!process.env.SLACK_CLIENT_ID) return fail(res, 400, "Slack not configured");
    const stateId = await createOauthState({
      userId: req.user!.id,
      workspaceId: req.workspaceId!,
      kind: "slack",
      returnTo: String(req.query.returnTo ?? "/app/integrations"),
    });
    const params = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      scope: "channels:read,chat:write,incoming-webhook",
      redirect_uri: `${appBaseUrl(req)}/integrations/slack/callback`,
      state: stateId,
    });
    return ok(res, { url: `https://slack.com/oauth/v2/authorize?${params.toString()}` });
  }),
);

integrationRoutes.get(
  "/integrations/slack/callback",
  asyncH(async (req: Request, res: Response) => {
    const code = String(req.query.code ?? "");
    const stateId = String(req.query.state ?? "");
    if (!code || !stateId) return fail(res, 400, "Missing code/state");
    const state = await consumeOauthState(stateId, "slack");
    if (!state) return fail(res, 400, "Invalid or expired state");
    if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET)
      return fail(res, 500, "Slack not configured");

    const form = new URLSearchParams({
      code,
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      redirect_uri: `${appBaseUrl(req)}/integrations/slack/callback`,
    });
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const tj = (await tokenRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!tj.ok) return fail(res, 401, `Slack error: ${String(tj.error ?? "unknown")}`);
    const accessToken = String((tj as { access_token: string }).access_token ?? "");
    const team = (tj as { team?: { id: string; name: string } }).team;
    const webhook = (tj as { incoming_webhook?: { url: string; channel: string; channel_id: string } })
      .incoming_webhook;

    await upsertIntegration({
      workspaceId: state.workspaceId,
      kind: "slack",
      accessToken,
      scope: String((tj as { scope?: string }).scope ?? ""),
      accountId: team?.id ?? "",
      accountName: team?.name ?? "",
      webhookUrl: webhook?.url ?? "",
      meta: { default_channel: webhook?.channel, default_channel_id: webhook?.channel_id },
      connectedById: state.userId,
    });
    res.redirect(`${frontendBaseUrl(req)}${state.returnTo || "/app/integrations"}?integration=slack&status=ok`);
  }),
);

integrationRoutes.post(
  "/integrations/slack/manual",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const schema = z.object({
      webhookUrl: z.string().url(),
      teamName: z.string().max(120).optional(),
    });
    const body = schema.parse(req.body);
    await upsertIntegration({
      workspaceId: req.workspaceId!,
      kind: "slack",
      accessToken: "manual",
      webhookUrl: body.webhookUrl,
      accountName: body.teamName ?? "Slack workspace",
      meta: { manual: true },
      connectedById: req.user!.id,
    });
    return ok(res, { ok: true });
  }),
);

integrationRoutes.get(
  "/integrations/slack/channels",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const integration = await Integration.findOne({
      workspaceId: req.workspaceId!,
      kind: "slack",
    }).lean();
    if (!integration) return fail(res, 404, "Slack not connected");
    if (integration.accessToken === "manual") {
      const meta = (integration.meta as Record<string, unknown>) ?? {};
      return ok(res, {
        channels: meta.default_channel_id
          ? [
              {
                id: String(meta.default_channel_id),
                name: String(meta.default_channel ?? "default"),
              },
            ]
          : [],
      });
    }
    const r = await fetch(
      "https://slack.com/api/conversations.list?exclude_archived=true&types=public_channel,private_channel&limit=200",
      { headers: { authorization: `Bearer ${integration.accessToken}` } },
    );
    const j = (await r.json().catch(() => ({}))) as { channels?: Array<{ id: string; name: string }> };
    return ok(res, {
      channels: (j.channels ?? []).map((c) => ({ id: c.id, name: c.name })),
    });
  }),
);

integrationRoutes.post(
  "/integrations/slack/link",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const schema = z.object({
      projectId: z.string(),
      channelId: z.string(),
      channelName: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const access = await ensureProjectAccess(req.user!.id, body.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const integration = await Integration.findOne({
      workspaceId: req.workspaceId!,
      kind: "slack",
    }).lean();
    if (!integration) return fail(res, 404, "Slack not connected");
    await IntegrationLink.updateOne(
      {
        integrationId: integration._id,
        projectId: body.projectId,
        externalId: body.channelId,
      },
      {
        $setOnInsert: {
          _id: prefixedId("lnk"),
          integrationId: integration._id,
          projectId: body.projectId,
          externalId: body.channelId,
          externalName: body.channelName ?? body.channelId,
          externalUrl: "",
        },
      },
      { upsert: true },
    );
    return ok(res, { ok: true });
  }),
);

// ============================================================
// NOTION
// ============================================================

integrationRoutes.get(
  "/integrations/notion/start",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    if (!process.env.NOTION_CLIENT_ID) return fail(res, 400, "Notion not configured");
    const stateId = await createOauthState({
      userId: req.user!.id,
      workspaceId: req.workspaceId!,
      kind: "notion",
      returnTo: String(req.query.returnTo ?? "/app/integrations"),
    });
    const params = new URLSearchParams({
      client_id: process.env.NOTION_CLIENT_ID,
      response_type: "code",
      owner: "user",
      redirect_uri: `${appBaseUrl(req)}/integrations/notion/callback`,
      state: stateId,
    });
    return ok(res, { url: `https://api.notion.com/v1/oauth/authorize?${params.toString()}` });
  }),
);

integrationRoutes.get(
  "/integrations/notion/callback",
  asyncH(async (req: Request, res: Response) => {
    const code = String(req.query.code ?? "");
    const stateId = String(req.query.state ?? "");
    if (!code || !stateId) return fail(res, 400, "Missing code/state");
    const state = await consumeOauthState(stateId, "notion");
    if (!state) return fail(res, 400, "Invalid or expired state");
    if (!process.env.NOTION_CLIENT_ID || !process.env.NOTION_CLIENT_SECRET)
      return fail(res, 500, "Notion not configured");

    const basic = Buffer.from(
      `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`,
    ).toString("base64");
    const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${basic}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${appBaseUrl(req)}/integrations/notion/callback`,
      }),
    });
    const tj = (await tokenRes.json().catch(() => ({}))) as Record<string, unknown>;
    const accessToken = String(tj.access_token ?? "");
    if (!accessToken) return fail(res, 401, "Notion did not return an access token");

    await upsertIntegration({
      workspaceId: state.workspaceId,
      kind: "notion",
      accessToken,
      scope: String((tj.bot_id as string | undefined) ?? ""),
      accountId: String((tj.workspace_id as string | undefined) ?? ""),
      accountName: String((tj.workspace_name as string | undefined) ?? "Notion workspace"),
      accountAvatar: String((tj.workspace_icon as string | undefined) ?? ""),
      meta: { bot_id: tj.bot_id, owner: tj.owner },
      connectedById: state.userId,
    });
    res.redirect(`${frontendBaseUrl(req)}${state.returnTo || "/app/integrations"}?integration=notion&status=ok`);
  }),
);

integrationRoutes.get(
  "/integrations/notion/pages",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const integration = await Integration.findOne({
      workspaceId: req.workspaceId!,
      kind: "notion",
    }).lean();
    if (!integration) return fail(res, 404, "Notion not connected");
    const r = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${integration.accessToken}`,
        "notion-version": "2022-06-28",
      },
      body: JSON.stringify({ filter: { property: "object", value: "page" }, page_size: 50 }),
    });
    const j = (await r.json().catch(() => ({}))) as { results?: Array<Record<string, unknown>> };
    const pages = (j.results ?? []).map((p) => {
      const props = (p.properties ?? {}) as Record<string, { title?: Array<{ plain_text: string }> }>;
      const titleProp = Object.values(props).find((v) => v.title);
      const title = titleProp?.title?.map((t) => t.plain_text).join("") ?? "Untitled";
      return {
        id: String(p.id),
        title,
        url: String(p.url ?? ""),
        lastEditedTime: String(p.last_edited_time ?? ""),
      };
    });
    return ok(res, { pages });
  }),
);

// Notion → markdown helpers
function richText(rt: Array<{ plain_text?: string }>): string {
  return (rt ?? []).map((t) => t.plain_text ?? "").join("");
}

async function notionFetchChildren(token: string, blockId: string): Promise<Array<Record<string, unknown>>> {
  const r = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`, {
    headers: { authorization: `Bearer ${token}`, "notion-version": "2022-06-28" },
  });
  if (!r.ok) return [];
  const j = (await r.json()) as { results?: Array<Record<string, unknown>> };
  return j.results ?? [];
}

async function blocksToMarkdown(
  token: string,
  blocks: Array<Record<string, unknown>>,
  depth = 0,
): Promise<string> {
  const indent = "  ".repeat(depth);
  const out: string[] = [];
  for (const b of blocks) {
    const type = String(b.type ?? "");
    const data = (b as Record<string, unknown>)[type] as { rich_text?: Array<{ plain_text?: string }>; language?: string };
    const text = data?.rich_text ? richText(data.rich_text) : "";
    switch (type) {
      case "heading_1":
        out.push(`${indent}# ${text}`);
        break;
      case "heading_2":
        out.push(`${indent}## ${text}`);
        break;
      case "heading_3":
        out.push(`${indent}### ${text}`);
        break;
      case "bulleted_list_item":
        out.push(`${indent}- ${text}`);
        break;
      case "numbered_list_item":
        out.push(`${indent}1. ${text}`);
        break;
      case "to_do":
        out.push(`${indent}- [ ] ${text}`);
        break;
      case "quote":
        out.push(`${indent}> ${text}`);
        break;
      case "code":
        out.push(`${indent}\`\`\`${data?.language ?? ""}\n${text}\n\`\`\``);
        break;
      case "divider":
        out.push(`${indent}---`);
        break;
      default:
        if (text) out.push(`${indent}${text}`);
    }
    if ((b as { has_children?: boolean }).has_children) {
      const children = await notionFetchChildren(token, String(b.id));
      const sub = await blocksToMarkdown(token, children, depth + 1);
      out.push(sub);
    }
  }
  return out.join("\n\n");
}

integrationRoutes.post(
  "/integrations/notion/import",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const schema = z.object({
      projectId: z.string(),
      pageId: z.string(),
      title: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const access = await ensureProjectAccess(req.user!.id, body.projectId);
    if (!access) return fail(res, 403, "Forbidden");
    const integration = await Integration.findOne({
      workspaceId: req.workspaceId!,
      kind: "notion",
    }).lean();
    if (!integration) return fail(res, 404, "Notion not connected");

    const pageRes = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
      headers: {
        authorization: `Bearer ${integration.accessToken}`,
        "notion-version": "2022-06-28",
      },
    });
    if (!pageRes.ok) return fail(res, pageRes.status, "Failed to fetch Notion page");
    const pageJson = (await pageRes.json()) as { properties?: Record<string, { title?: Array<{ plain_text: string }> }> };
    const titleProp = Object.values(pageJson.properties ?? {}).find((v) => v.title);
    const fallbackTitle = titleProp?.title?.map((t) => t.plain_text).join("") ?? "Notion import";
    const title = body.title ?? fallbackTitle;

    const blocks = await notionFetchChildren(integration.accessToken, body.pageId);
    const content = await blocksToMarkdown(integration.accessToken, blocks);

    let slug = slugify(title);
    while (await WikiPage.findOne({ projectId: body.projectId, slug }).lean()) {
      slug = `${slugify(title)}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const id = prefixedId("wik");
    await WikiPage.create({
      _id: id,
      projectId: body.projectId,
      title,
      slug,
      content,
      category: "Imported",
      authorId: req.user!.id,
    });
    return ok(res, { id, slug, title }, 201);
  }),
);
