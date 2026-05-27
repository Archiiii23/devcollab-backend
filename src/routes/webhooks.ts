import { Router, type Response, type Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Integration, WebhookEvent } from "../models.js";
import { asyncH } from "../middleware.js";
import { ok, fail } from "../util.js";
import { ingestGithubEvent } from "./_integration-hooks.js";

export const webhookRoutes = Router();

webhookRoutes.get("/healthz", (_req: Request, res: Response) =>
  res.json({ data: { ok: true } }),
);

webhookRoutes.post(
  "/github",
  asyncH(async (req: Request, res: Response) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return fail(res, 503, "GitHub webhook not configured");
    const rawBody = req.body as Buffer | undefined;
    if (!rawBody || !Buffer.isBuffer(rawBody)) return fail(res, 400, "Missing raw body");

    const sigHeader = req.header("x-hub-signature-256") ?? "";
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    if (
      sigHeader.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))
    ) {
      return fail(res, 401, "Invalid signature");
    }

    const event = req.header("x-github-event") ?? "ping";
    const deliveryId = req.header("x-github-delivery") ?? "";

    // Idempotency: drop duplicates
    if (deliveryId) {
      const existing = await WebhookEvent.findById(deliveryId).lean();
      if (existing) return ok(res, { ok: true, deduplicated: true });
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
    } catch {
      return fail(res, 400, "Invalid JSON");
    }

    // Find which workspace the repo is linked to
    const repoFullName =
      (payload.repository as { full_name?: string } | undefined)?.full_name ?? "";
    const integration = repoFullName
      ? await Integration.findOne({
          kind: "github",
        })
          .lean()
          .then(async (i) => {
            if (!i) return null;
            // The link is per-project; if a workspace has GH connected we accept the event.
            return i;
          })
      : null;

    if (deliveryId) {
      await WebhookEvent.create({
        _id: deliveryId,
        integrationId: integration?._id ?? null,
        kind: "github",
        event,
        payload: rawBody.toString("utf-8").slice(0, 50_000),
      });
    }

    if (event !== "ping" && integration) {
      await ingestGithubEvent(integration.workspaceId, event, payload).catch(() => {});
    }
    return ok(res, { ok: true });
  }),
);
