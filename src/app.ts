import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { z } from "zod";
import { connectDb } from "./db.js";
import { attachUser } from "./auth.js";
import { fail } from "./util.js";
import { authRoutes } from "./routes/auth.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { projectRoutes } from "./routes/projects.js";
import { taskRoutes } from "./routes/tasks.js";
import { wikiRoutes } from "./routes/wiki.js";
import { snippetRoutes } from "./routes/snippets.js";
import { activityRoutes } from "./routes/activity.js";
import { notificationRoutes } from "./routes/notifications.js";
import { memberRoutes } from "./routes/members.js";
import { billingRoutes } from "./routes/billing.js";
import { aiRoutes } from "./routes/ai.js";
import { presenceRoutes } from "./routes/presence.js";
import { integrationRoutes } from "./routes/integrations.js";
import { webhookRoutes } from "./routes/webhooks.js";

const DEFAULT_FRONTEND_ORIGINS = [
  "https://hackathon-round.vercel.app",
];

function buildAllowedOrigins(): (string | RegExp)[] {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    // Allow any *.vercel.app preview deployment of the frontend
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
    ...DEFAULT_FRONTEND_ORIGINS,
    ...list,
  ];
}

export function buildApp() {
  const app = express();

  // Connect to MongoDB before any request runs. The connection is cached.
  app.use(async (_req, _res, next) => {
    try {
      await connectDb();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowed = buildAllowedOrigins();
        const ok = allowed.some((p) =>
          typeof p === "string" ? p === origin : p.test(origin),
        );
        cb(null, ok);
      },
      credentials: true,
    }),
  );

  // Webhooks need raw body for HMAC verification — keep this before json parser.
  app.use("/webhooks", express.raw({ type: "application/json", limit: "2mb" }));

  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(attachUser);

  // ---------- Public ----------
  app.get("/health", (_req: Request, res: Response) => res.json({ data: { ok: true } }));
  app.get("/healthz", (_req: Request, res: Response) => res.json({ data: { ok: true } }));

  // ---------- Routes ----------
  app.use(authRoutes);
  app.use(workspaceRoutes);
  app.use(projectRoutes);
  app.use(taskRoutes);
  app.use(wikiRoutes);
  app.use(snippetRoutes);
  app.use(activityRoutes);
  app.use(notificationRoutes);
  app.use(memberRoutes);
  app.use(billingRoutes);
  app.use(aiRoutes);
  app.use(presenceRoutes);
  app.use(integrationRoutes);
  app.use("/webhooks", webhookRoutes);

  // ---------- 404 ----------
  app.use((req: Request, res: Response) => {
    fail(res, 404, `Not found: ${req.method} ${req.path}`);
  });

  // ---------- Error handler ----------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      return fail(res, 400, "Invalid request body", { issues: err.issues });
    }
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("API error:", err);
    fail(res, 500, msg);
  });

  return app;
}
