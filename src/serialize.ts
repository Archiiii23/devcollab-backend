import { initialsFromName } from "./auth.js";

interface UserDoc {
  _id: string;
  email: string;
  name: string;
  avatarColor: string;
  avatarUrl?: string | null;
  bio?: string;
  skills?: string[];
  githubUrl?: string;
}

export function publicUser(u: UserDoc) {
  return {
    id: u._id,
    email: u.email,
    name: u.name,
    avatarColor: u.avatarColor,
    avatarUrl: u.avatarUrl ?? null,
    initials: initialsFromName(u.name),
  };
}

export function publicUserFull(u: UserDoc) {
  return {
    ...publicUser(u),
    bio: u.bio ?? "",
    skills: u.skills ?? [],
    githubUrl: u.githubUrl ?? "",
  };
}

export function publicWorkspace(w: { _id: string; name: string; slug: string; tier?: string }) {
  return { id: w._id, name: w.name, slug: w.slug };
}

export function publicProject(p: {
  _id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  color?: string;
  icon?: string;
  archived?: boolean;
  createdAt?: Date | string | number;
  updatedAt?: Date | string | number;
}) {
  return {
    id: p._id,
    workspaceId: p.workspaceId,
    name: p.name,
    slug: p.slug,
    description: p.description ?? "",
    color: p.color ?? "oklch(0.65 0.14 240)",
    icon: p.icon ?? "",
    archived: p.archived ?? false,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function publicTask(
  t: {
    _id: string;
    projectId: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    due?: Date | null;
    position?: number;
    assigneeId?: string | null;
    labels?: Array<{ name: string; tone?: string }>;
    createdAt?: Date | string | number;
    updatedAt?: Date | string | number;
  },
  assigneeMap?: Map<string, ReturnType<typeof publicUser>>,
) {
  return {
    id: t._id,
    projectId: t.projectId,
    title: t.title,
    description: t.description ?? "",
    status: t.status,
    priority: t.priority,
    due: t.due ?? null,
    position: t.position ?? 0,
    assignee: t.assigneeId ? (assigneeMap?.get(t.assigneeId) ?? null) : null,
    labels: (t.labels ?? []).map((l) => ({ name: l.name, tone: l.tone ?? "" })),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function publicSnippet(s: {
  _id: string;
  projectId: string;
  title: string;
  description?: string;
  language: string;
  code: string;
  tags?: string[];
  authorId: string;
  createdAt?: Date | string | number;
  updatedAt?: Date | string | number;
}, author: ReturnType<typeof publicUser>) {
  return {
    id: s._id,
    projectId: s.projectId,
    title: s.title,
    description: s.description ?? "",
    language: s.language,
    code: s.code,
    tags: s.tags ?? [],
    author,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function publicWikiPage(p: {
  _id: string;
  projectId: string;
  title: string;
  slug: string;
  content: string;
  category: string;
  authorId: string;
  createdAt?: Date | string | number;
  updatedAt?: Date | string | number;
}, author: ReturnType<typeof publicUser>) {
  return {
    id: p._id,
    projectId: p.projectId,
    title: p.title,
    slug: p.slug,
    content: p.content,
    category: p.category,
    author,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
