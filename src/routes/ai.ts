import { Router, type Response } from "express";
import { z } from "zod";
import { type AuthedRequest, requireUser } from "../auth.js";
import { asyncH, withWorkspace } from "../middleware.js";
import { ok } from "../util.js";
import { runAi, type AiKind, type AiPlatform } from "../ai.js";

export const aiRoutes = Router();

const aiSchema = z.object({
  kind: z.enum([
    "summary",
    "explain",
    "standup",
    "refactor",
    "db",
    "architecture",
    "chat",
    "code-review",
    "task-breakdown",
    "blockers",
  ]),
  platform: z.enum(["gemini", "claude", "gpt"]).optional(),
  prompt: z.string().min(1).max(8000),
  context: z.string().max(20000).optional(),
});

aiRoutes.post(
  "/ai",
  requireUser,
  withWorkspace,
  asyncH(async (req: AuthedRequest, res: Response) => {
    const body = aiSchema.parse(req.body);
    const out = await runAi({
      kind: body.kind as AiKind,
      platform: body.platform as AiPlatform | undefined,
      prompt: body.prompt,
      context: body.context,
    });
    return ok(res, out);
  }),
);
