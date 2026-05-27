import { prefixedId, slugify } from "./ids.js";
import { hashPassword, pickColor, newUserId } from "./auth.js";
import {
  Project,
  Snippet,
  Task,
  TaskComment,
  User,
  WikiPage,
  Workspace,
  WorkspaceMember,
  Activity,
} from "./models.js";

const DEMO_EMAIL = "demo@devcollab.dev";
const DEMO_PASSWORD = "demodemo";

export async function ensureDemoUser() {
  const existing = await User.findOne({ email: DEMO_EMAIL }).lean();
  if (existing) return { id: existing._id, email: DEMO_EMAIL, password: DEMO_PASSWORD, created: false };
  const id = newUserId();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await User.create({
    _id: id,
    email: DEMO_EMAIL,
    name: "Demo User",
    passwordHash,
    avatarColor: pickColor(DEMO_EMAIL),
  });
  const ws = await Workspace.findOne().lean();
  if (ws) {
    await WorkspaceMember.updateOne(
      { workspaceId: ws._id, userId: id },
      { $setOnInsert: { workspaceId: ws._id, userId: id, role: "member" } },
      { upsert: true },
    );
  }
  return { id, email: DEMO_EMAIL, password: DEMO_PASSWORD, created: true };
}

export async function seedIfEmpty() {
  const userCount = await User.estimatedDocumentCount();
  if (userCount > 0) return { seeded: false };

  const ownerId = newUserId();
  await User.create({
    _id: ownerId,
    email: "alex@devcollab.dev",
    name: "Alex Founder",
    passwordHash: await hashPassword("password123"),
    avatarColor: pickColor("alex"),
  });

  const m1 = newUserId();
  const m2 = newUserId();
  const m3 = newUserId();
  await User.insertMany([
    {
      _id: m1,
      email: "jordan@devcollab.dev",
      name: "Jordan Lee",
      passwordHash: await hashPassword("password123"),
      avatarColor: pickColor("jordan"),
    },
    {
      _id: m2,
      email: "sam@devcollab.dev",
      name: "Sam Patel",
      passwordHash: await hashPassword("password123"),
      avatarColor: pickColor("sam"),
    },
    {
      _id: m3,
      email: "riley@devcollab.dev",
      name: "Riley Kim",
      passwordHash: await hashPassword("password123"),
      avatarColor: pickColor("riley"),
    },
  ]);

  const wsId = prefixedId("ws");
  await Workspace.create({
    _id: wsId,
    name: "DevCollab HQ",
    slug: "devcollab-hq",
    ownerId,
  });

  await WorkspaceMember.insertMany([
    { workspaceId: wsId, userId: ownerId, role: "owner" },
    { workspaceId: wsId, userId: m1, role: "admin" },
    { workspaceId: wsId, userId: m2, role: "member" },
    { workspaceId: wsId, userId: m3, role: "member" },
  ]);

  const projects = [
    { name: "DevCollab Platform", description: "The collaborative dev workspace.", color: "oklch(0.65 0.14 240)", icon: "Sparkles" },
    { name: "Mobile App", description: "iOS + Android client.", color: "oklch(0.7 0.15 155)", icon: "Smartphone" },
    { name: "Marketing Site", description: "Public-facing marketing pages.", color: "oklch(0.78 0.14 80)", icon: "Globe" },
  ];
  const createdProjects: { id: string; name: string }[] = [];
  for (const p of projects) {
    const id = prefixedId("prj");
    await Project.create({
      _id: id,
      workspaceId: wsId,
      name: p.name,
      slug: slugify(p.name),
      description: p.description,
      color: p.color,
      icon: p.icon,
    });
    createdProjects.push({ id, name: p.name });
  }

  const tasks = [
    { title: "Design board drag handles", status: "in_progress", priority: "high", assignee: m1 },
    { title: "Wire up wiki autosave", status: "review", priority: "medium", assignee: m2 },
    { title: "Add snippet syntax highlighter", status: "todo", priority: "medium", assignee: m3 },
    { title: "Polish auth onboarding", status: "todo", priority: "high", assignee: ownerId },
    { title: "Ship release notes 1.4", status: "done", priority: "low", assignee: m1 },
    { title: "Investigate slow standup query", status: "backlog", priority: "low", assignee: m2 },
  ];
  let pos = 0;
  for (const t of tasks) {
    await Task.create({
      _id: prefixedId("tsk"),
      projectId: createdProjects[0].id,
      title: t.title,
      description: "",
      status: t.status,
      priority: t.priority,
      assigneeId: t.assignee,
      position: pos++,
      labels: [],
    });
  }

  // Wiki + snippets
  await WikiPage.create({
    _id: prefixedId("wik"),
    projectId: createdProjects[0].id,
    title: "Getting Started",
    slug: "getting-started",
    content: "# Welcome\n\nThis is your team's shared wiki. Edit any page to update it.",
    category: "General",
    authorId: ownerId,
  });
  await Snippet.create({
    _id: prefixedId("snp"),
    projectId: createdProjects[0].id,
    title: "useDebounce hook",
    description: "A tiny debounce hook used across the app.",
    language: "ts",
    code: `import { useEffect, useState } from "react";\nexport function useDebounce<T>(v: T, ms = 250): T {\n  const [d, set] = useState(v);\n  useEffect(() => {\n    const id = setTimeout(() => set(v), ms);\n    return () => clearTimeout(id);\n  }, [v, ms]);\n  return d;\n}`,
    authorId: ownerId,
    tags: ["hooks", "react", "performance"],
  });

  await Activity.create({
    _id: prefixedId("act"),
    workspaceId: wsId,
    projectId: createdProjects[0].id,
    actorId: ownerId,
    action: "created",
    targetType: "project",
    targetId: createdProjects[0].id,
    targetLabel: createdProjects[0].name,
  });

  // Suppress unused import warning for TaskComment
  void TaskComment;

  return { seeded: true, workspaceId: wsId };
}
