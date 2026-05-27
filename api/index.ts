import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildApp } from "../src/app.js";

// Disable Vercel's automatic body parsing so express + raw webhooks work.
export const config = { api: { bodyParser: false } };

const app = buildApp();

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as never, res as never);
}
