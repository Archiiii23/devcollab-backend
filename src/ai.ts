export type AiKind =
  | "summary"
  | "explain"
  | "standup"
  | "refactor"
  | "db"
  | "architecture"
  | "chat"
  | "code-review"
  | "task-breakdown"
  | "blockers";
export type AiPlatform = "gemini" | "claude" | "gpt";

const PLATFORM_LABEL: Record<AiPlatform, string> = {
  gemini: "Gemini 1.5 Pro",
  claude: "Claude 3.5 Sonnet",
  gpt: "GPT-4o",
};

export interface AiRequest {
  kind: AiKind;
  platform?: AiPlatform;
  prompt: string;
  context?: string;
}

export interface AiIssue {
  severity: "info" | "warn" | "error";
  category: "bug" | "performance" | "readability" | "security";
  line?: number;
  message: string;
}
export interface AiSubtask {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  labels?: { name: string; tone: "green" | "blue" | "yellow" | "red" | "gray" }[];
  estimate?: string;
}
export interface AiBlocker {
  taskId?: string;
  title: string;
  reason: string;
  daysStuck?: number;
}

export type AiStructured =
  | { kind: "code-review"; score: number; summary: string; issues: AiIssue[] }
  | { kind: "task-breakdown"; subtasks: AiSubtask[] }
  | { kind: "blockers"; blocked: AiBlocker[] };

export interface AiResponse {
  output: string;
  model: string;
  provider: "openai" | "mock";
  data?: AiStructured;
}

function systemPrompt(kind: AiKind, platform: AiPlatform): string {
  const persona = PLATFORM_LABEL[platform];
  switch (kind) {
    case "summary":
      return `You are ${persona} helping summarize a developer wiki page. Respond in concise Markdown with 3-5 bullet points and a one-line conclusion.`;
    case "explain":
      return `You are ${persona}, a senior code reviewer. Explain the provided snippet in plain English. Cover purpose, structure, and one improvement suggestion in bullet points.`;
    case "standup":
      return `You are ${persona}. Draft a brief engineering standup from the given activity. Use bullet points grouped by Yesterday / Today / Blockers.`;
    case "refactor":
      return `You are ${persona}. Suggest a concrete refactor for the provided code. Return a short paragraph plus a fenced TypeScript code block with the improved version.`;
    case "db":
      return `You are ${persona}. Help the developer with MongoDB questions. Provide a short explanation and a runnable example.`;
    case "architecture":
      return `You are ${persona}. Explain the codebase architecture. Use 3-4 numbered points.`;
    case "code-review":
      return `You are ${persona}, a meticulous senior code reviewer. Review the provided code for bugs, performance issues, readability suggestions, and security concerns. Respond ONLY with strict JSON of shape: {"score":1-10,"summary":"...","issues":[{"severity":"info|warn|error","category":"bug|performance|readability|security","line":<int|null>,"message":"..."}]}. No prose outside the JSON.`;
    case "task-breakdown":
      return `You are ${persona}. Break the user's feature description into 4-8 concrete engineering subtasks. Respond ONLY with strict JSON of shape: {"subtasks":[{"title":"...","description":"...","priority":"low|medium|high|urgent","labels":[{"name":"...","tone":"green|blue|yellow|red|gray"}],"estimate":"e.g. 2h | 1d"}]}. No prose outside the JSON.`;
    case "blockers":
      return `You are ${persona}. Identify blocked tasks from the provided task list. A task is blocked if it has been in "in_progress" or "review" for more than 5 days, or if its description mentions waiting/blocked. Respond ONLY with strict JSON of shape: {"blocked":[{"taskId":"...","title":"...","reason":"...","daysStuck":<int>}]}. No prose outside the JSON.`;
    default:
      return `You are ${persona}, a developer-focused assistant inside DevCollab.`;
  }
}

function tryParseStructured(kind: AiKind, raw: string): AiStructured | undefined {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    if (kind === "code-review") {
      const score = Number(parsed.score ?? 5);
      const issues = Array.isArray(parsed.issues)
        ? (parsed.issues as Record<string, unknown>[]).slice(0, 30).map((i) => ({
            severity: (["info", "warn", "error"].includes(String(i.severity))
              ? i.severity
              : "info") as AiIssue["severity"],
            category: (["bug", "performance", "readability", "security"].includes(String(i.category))
              ? i.category
              : "readability") as AiIssue["category"],
            line: Number.isFinite(Number(i.line)) ? Number(i.line) : undefined,
            message: String(i.message ?? ""),
          }))
        : [];
      return {
        kind: "code-review",
        score: Math.max(1, Math.min(10, Math.round(score))),
        summary: String(parsed.summary ?? ""),
        issues,
      };
    }
    if (kind === "task-breakdown") {
      const subtasks = Array.isArray(parsed.subtasks)
        ? (parsed.subtasks as Record<string, unknown>[]).slice(0, 12).map((s) => ({
            title: String(s.title ?? ""),
            description: String(s.description ?? ""),
            priority: (["low", "medium", "high", "urgent"].includes(String(s.priority))
              ? s.priority
              : "medium") as AiSubtask["priority"],
            labels: Array.isArray(s.labels)
              ? (s.labels as Record<string, unknown>[]).slice(0, 5).map((l) => ({
                  name: String(l.name ?? ""),
                  tone: (["green", "blue", "yellow", "red", "gray"].includes(String(l.tone))
                    ? l.tone
                    : "gray") as "green" | "blue" | "yellow" | "red" | "gray",
                }))
              : undefined,
            estimate: s.estimate ? String(s.estimate) : undefined,
          }))
        : [];
      return { kind: "task-breakdown", subtasks };
    }
    if (kind === "blockers") {
      const blocked = Array.isArray(parsed.blocked)
        ? (parsed.blocked as Record<string, unknown>[]).slice(0, 20).map((b) => ({
            taskId: b.taskId ? String(b.taskId) : undefined,
            title: String(b.title ?? ""),
            reason: String(b.reason ?? ""),
            daysStuck: Number.isFinite(Number(b.daysStuck)) ? Number(b.daysStuck) : undefined,
          }))
        : [];
      return { kind: "blockers", blocked };
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

async function callOpenAi(req: AiRequest, platform: AiPlatform): Promise<AiResponse | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const base = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt(req.kind, platform) },
          ...(req.context ? [{ role: "user", content: `Context:\n${req.context}` }] : []),
          { role: "user", content: req.prompt },
        ],
        temperature: 0.4,
        max_tokens: 600,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const output = data.choices?.[0]?.message?.content?.trim();
    if (!output) return null;
    return { output, model, provider: "openai" };
  } catch {
    return null;
  }
}

function deterministicOutput(req: AiRequest, platform: AiPlatform): string {
  const persona = PLATFORM_LABEL[platform];
  const note = "_Generated locally without an LLM key._";
  switch (req.kind) {
    case "summary":
      return `### AI Summary (${persona})\n\n- Overview of purpose and scope.\n- Setup steps and prerequisites.\n- Key APIs and conventions.\n- Common pitfalls to watch for.\n\n${note}`;
    case "explain":
      return `### Code Walkthrough (${persona})\n\n- Encapsulates a reusable helper.\n- Minimal side-effects.\n- Suggest extracting magic numbers into named constants.\n\n${note}`;
    case "standup":
      return `### Standup draft — ${persona}\n\n**Yesterday**\n- Closed two PRs.\n\n**Today**\n- Finish smoke tests and release notes.\n\n**Blockers**\n- Waiting on sandbox keys.\n\n${note}`;
    case "refactor":
      return `### Refactor proposal (${persona})\n\nExtract the state mutation into a pure reducer.\n\n\`\`\`typescript\nexport function moveTask(tasks: Task[], id: string, next: Status): Task[] {\n  return tasks.map((t) => (t.id === id ? { ...t, status: next } : t));\n}\n\`\`\`\n\n${note}`;
    case "db":
      return `### MongoDB quick guide (${persona})\n\n\`\`\`js\nconst Task = mongoose.model('Task', new Schema({ title: String, status: String }));\nawait Task.findOneAndUpdate({ _id: id }, { status: 'done' });\n\`\`\`\n\n${note}`;
    case "architecture":
      return `### DevCollab architecture (${persona})\n\n1. React 19 SPA hits the Express API.\n2. MongoDB stores users, workspaces, projects, tasks, wiki, snippets.\n3. Cookie sessions; React Query caches & invalidates.\n4. AI proxy provides structured outputs.\n\n${note}`;
    case "code-review": {
      const src = req.context ?? req.prompt;
      const lines = src.split("\n");
      const has = (re: RegExp) => lines.some((l) => re.test(l));
      const issues: AiIssue[] = [];
      if (has(/==/) && !has(/===/))
        issues.push({ severity: "warn", category: "bug", message: "Prefer strict equality (===)." });
      if (has(/console\.log/))
        issues.push({ severity: "info", category: "readability", message: "Strip console.log before shipping." });
      if (has(/eval\(/))
        issues.push({ severity: "error", category: "security", message: "eval() is unsafe." });
      if (has(/innerHTML\s*=/))
        issues.push({
          severity: "error",
          category: "security",
          message: "innerHTML can introduce XSS; sanitize or use textContent.",
        });
      if (!issues.length)
        issues.push({
          severity: "info",
          category: "readability",
          message: "No obvious issues found.",
        });
      const score = Math.max(4, 10 - issues.filter((i) => i.severity !== "info").length * 2);
      return JSON.stringify({
        score,
        summary: `Static heuristic review by ${persona}: ${lines.length} lines analyzed, ${issues.length} findings.`,
        issues,
      });
    }
    case "task-breakdown": {
      const feature = req.prompt.trim().slice(0, 80);
      return JSON.stringify({
        subtasks: [
          {
            title: `Design data model for ${feature}`,
            description: "Sketch the schemas and write a migration.",
            priority: "high",
            labels: [{ name: "backend", tone: "blue" }],
            estimate: "3h",
          },
          {
            title: `Backend endpoints for ${feature}`,
            description: "Implement CRUD routes with validation.",
            priority: "high",
            labels: [{ name: "backend", tone: "blue" }],
            estimate: "4h",
          },
          {
            title: `Frontend UI for ${feature}`,
            description: "Build the page and wire it to the API client.",
            priority: "medium",
            labels: [{ name: "frontend", tone: "green" }],
            estimate: "5h",
          },
          {
            title: `Error & loading states`,
            description: "Add skeletons, empty states, error messages.",
            priority: "medium",
            labels: [{ name: "ux", tone: "yellow" }],
            estimate: "1h",
          },
          {
            title: `Tests & QA`,
            description: "Unit & integration tests; smoke test.",
            priority: "medium",
            labels: [{ name: "qa", tone: "gray" }],
            estimate: "2h",
          },
          {
            title: `Docs + release notes`,
            description: "Update wiki and changelog.",
            priority: "low",
            labels: [{ name: "docs", tone: "gray" }],
            estimate: "1h",
          },
        ],
      });
    }
    case "blockers":
      return JSON.stringify({ blocked: [] });
    case "chat":
    default:
      return `**${persona}**: ${req.prompt.trim()}\n\n${note}`;
  }
}

export async function runAi(req: AiRequest): Promise<AiResponse> {
  const platform = req.platform ?? "gpt";
  const fromLlm = await callOpenAi(req, platform);
  if (fromLlm) {
    const parsed = tryParseStructured(req.kind, fromLlm.output);
    return { ...fromLlm, data: parsed };
  }
  const output = deterministicOutput(req, platform);
  const parsed = tryParseStructured(req.kind, output);
  return { output, model: "mock-1.0", provider: "mock", data: parsed };
}
