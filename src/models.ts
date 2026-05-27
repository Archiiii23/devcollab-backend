import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const baseOpts = { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } as const };

// ---------- User ----------
const UserSchema = new Schema(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    avatarColor: { type: String, default: "oklch(0.65 0.14 240)" },
    avatarUrl: { type: String, default: "" },
    bio: { type: String, default: "" },
    skills: { type: [String], default: [] },
    githubUrl: { type: String, default: "" },
  },
  baseOpts,
);

// ---------- Session ----------
const SessionSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

// ---------- Workspace ----------
const WorkspaceSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    ownerId: { type: String, required: true, index: true },
    tier: { type: String, enum: ["free", "pro"], default: "free" },
    tierUpdatedAt: { type: Date, default: () => new Date(0) },
  },
  baseOpts,
);

// ---------- WorkspaceMember ----------
const WorkspaceMemberSchema = new Schema(
  {
    workspaceId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ["owner", "admin", "member", "viewer"], default: "member" },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);
WorkspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

// ---------- WorkspaceInvite ----------
const WorkspaceInviteSchema = new Schema(
  {
    _id: { type: String, required: true },
    workspaceId: { type: String, required: true, index: true },
    email: { type: String, required: true, index: true, lowercase: true },
    role: { type: String, enum: ["admin", "member", "viewer"], default: "member" },
    token: { type: String, required: true, unique: true },
    invitedById: { type: String, required: true },
    acceptedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  baseOpts,
);

// ---------- Project ----------
const ProjectSchema = new Schema(
  {
    _id: { type: String, required: true },
    workspaceId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, index: true },
    description: { type: String, default: "" },
    color: { type: String, default: "oklch(0.65 0.14 240)" },
    icon: { type: String, default: "" },
    archived: { type: Boolean, default: false },
  },
  baseOpts,
);
ProjectSchema.index({ workspaceId: 1, slug: 1 }, { unique: true });

// ---------- Task ----------
const TaskLabelSchema = new Schema(
  { name: { type: String, required: true }, tone: { type: String, default: "" } },
  { _id: false },
);
const TaskSchema = new Schema(
  {
    _id: { type: String, required: true },
    projectId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: ["backlog", "todo", "in_progress", "review", "done"],
      default: "todo",
      index: true,
    },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    due: { type: Date, default: null },
    position: { type: Number, default: 0 },
    assigneeId: { type: String, default: null, index: true },
    labels: { type: [TaskLabelSchema], default: [] },
  },
  baseOpts,
);

// ---------- TaskComment ----------
const TaskCommentSchema = new Schema(
  {
    _id: { type: String, required: true },
    taskId: { type: String, required: true, index: true },
    authorId: { type: String, required: true },
    body: { type: String, required: true },
    mentions: { type: [String], default: [] },
  },
  baseOpts,
);

// ---------- TaskAttachment ----------
const TaskAttachmentSchema = new Schema(
  {
    _id: { type: String, required: true },
    taskId: { type: String, required: true, index: true },
    url: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: Number, default: 0 },
    mime: { type: String, default: "" },
    uploadedById: { type: String, required: true },
  },
  baseOpts,
);

// ---------- WikiPage ----------
const WikiPageSchema = new Schema(
  {
    _id: { type: String, required: true },
    projectId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    content: { type: String, default: "" },
    category: { type: String, default: "General" },
    authorId: { type: String, required: true },
  },
  baseOpts,
);

// ---------- WikiVersion ----------
const WikiVersionSchema = new Schema(
  {
    _id: { type: String, required: true },
    pageId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    content: { type: String, default: "" },
    category: { type: String, default: "General" },
    authorId: { type: String, required: true },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

// ---------- Snippet ----------
const SnippetSchema = new Schema(
  {
    _id: { type: String, required: true },
    projectId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    language: { type: String, default: "ts" },
    code: { type: String, required: true },
    authorId: { type: String, required: true },
    tags: { type: [String], default: [] },
  },
  baseOpts,
);

// ---------- Activity ----------
const ActivitySchema = new Schema(
  {
    _id: { type: String, required: true },
    workspaceId: { type: String, required: true, index: true },
    projectId: { type: String, default: null, index: true },
    actorId: { type: String, default: null },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    targetLabel: { type: String, default: "" },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);
ActivitySchema.index({ workspaceId: 1, createdAt: -1 });
ActivitySchema.index({ projectId: 1, createdAt: -1 });

// ---------- Notification ----------
const NotificationSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    workspaceId: { type: String, default: null },
    projectId: { type: String, default: null },
    kind: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    actorId: { type: String, default: null },
    readAt: { type: Date, default: null },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, readAt: 1 });

// ---------- Integration ----------
const IntegrationSchema = new Schema(
  {
    _id: { type: String, required: true },
    workspaceId: { type: String, required: true, index: true },
    kind: { type: String, enum: ["github", "slack", "notion"], required: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, default: null },
    scope: { type: String, default: "" },
    accountId: { type: String, default: "" },
    accountName: { type: String, default: "" },
    accountAvatar: { type: String, default: "" },
    webhookUrl: { type: String, default: "" },
    webhookSecret: { type: String, default: "" },
    meta: { type: Schema.Types.Mixed, default: {} },
    connectedById: { type: String, required: true },
  },
  baseOpts,
);
IntegrationSchema.index({ workspaceId: 1, kind: 1 }, { unique: true });

const IntegrationLinkSchema = new Schema(
  {
    _id: { type: String, required: true },
    integrationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    externalId: { type: String, required: true },
    externalName: { type: String, default: "" },
    externalUrl: { type: String, default: "" },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);
IntegrationLinkSchema.index(
  { integrationId: 1, projectId: 1, externalId: 1 },
  { unique: true },
);

const OAuthStateSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    workspaceId: { type: String, required: true },
    kind: { type: String, required: true },
    returnTo: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

const WebhookEventSchema = new Schema(
  {
    _id: { type: String, required: true },
    integrationId: { type: String, default: null },
    kind: { type: String, required: true },
    event: { type: String, required: true },
    payload: { type: String, default: "" },
  },
  { timestamps: { createdAt: "receivedAt", updatedAt: false } },
);

// ---------- Presence (heartbeat-based, polled) ----------
const PresenceSchema = new Schema(
  {
    projectId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    name: { type: String, default: "" },
    initials: { type: String, default: "" },
    avatarColor: { type: String, default: "" },
    avatarUrl: { type: String, default: "" },
    lastSeen: { type: Date, default: () => new Date() },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);
PresenceSchema.index({ projectId: 1, userId: 1 }, { unique: true });
PresenceSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 90 });

// ---------- Helper to register exactly once (Vercel re-imports modules) ----------
function getModel<T>(name: string, schema: Schema): Model<T> {
  return (models[name] as Model<T>) ?? model<T>(name, schema);
}

export const User = getModel<InferSchemaType<typeof UserSchema>>("User", UserSchema);
export const Session = getModel<InferSchemaType<typeof SessionSchema>>("Session", SessionSchema);
export const Workspace = getModel<InferSchemaType<typeof WorkspaceSchema>>("Workspace", WorkspaceSchema);
export const WorkspaceMember = getModel<InferSchemaType<typeof WorkspaceMemberSchema>>(
  "WorkspaceMember",
  WorkspaceMemberSchema,
);
export const WorkspaceInvite = getModel<InferSchemaType<typeof WorkspaceInviteSchema>>(
  "WorkspaceInvite",
  WorkspaceInviteSchema,
);
export const Project = getModel<InferSchemaType<typeof ProjectSchema>>("Project", ProjectSchema);
export const Task = getModel<InferSchemaType<typeof TaskSchema>>("Task", TaskSchema);
export const TaskComment = getModel<InferSchemaType<typeof TaskCommentSchema>>(
  "TaskComment",
  TaskCommentSchema,
);
export const TaskAttachment = getModel<InferSchemaType<typeof TaskAttachmentSchema>>(
  "TaskAttachment",
  TaskAttachmentSchema,
);
export const WikiPage = getModel<InferSchemaType<typeof WikiPageSchema>>("WikiPage", WikiPageSchema);
export const WikiVersion = getModel<InferSchemaType<typeof WikiVersionSchema>>(
  "WikiVersion",
  WikiVersionSchema,
);
export const Snippet = getModel<InferSchemaType<typeof SnippetSchema>>("Snippet", SnippetSchema);
export const Activity = getModel<InferSchemaType<typeof ActivitySchema>>("Activity", ActivitySchema);
export const Notification = getModel<InferSchemaType<typeof NotificationSchema>>(
  "Notification",
  NotificationSchema,
);
export const Integration = getModel<InferSchemaType<typeof IntegrationSchema>>(
  "Integration",
  IntegrationSchema,
);
export const IntegrationLink = getModel<InferSchemaType<typeof IntegrationLinkSchema>>(
  "IntegrationLink",
  IntegrationLinkSchema,
);
export const OAuthState = getModel<InferSchemaType<typeof OAuthStateSchema>>(
  "OAuthState",
  OAuthStateSchema,
);
export const WebhookEvent = getModel<InferSchemaType<typeof WebhookEventSchema>>(
  "WebhookEvent",
  WebhookEventSchema,
);
export const Presence = getModel<InferSchemaType<typeof PresenceSchema>>("Presence", PresenceSchema);
