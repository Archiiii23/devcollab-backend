# DevCollab Backend (MERN)

Express + Mongoose REST API for DevCollab, deployed as a single Vercel serverless function.

## Stack

- **Runtime**: Node.js 20+ on Vercel Functions
- **Server**: Express 4
- **Database**: MongoDB (Atlas free tier works)
- **ORM**: Mongoose
- **Validation**: Zod
- **Auth**: PBKDF2 password hashing (`node:crypto`) + HTTP-only session cookies stored in the `sessions` collection
- **AI**: OpenAI-compatible Chat Completions when `OPENAI_API_KEY` is set, deterministic local fallback otherwise

## Local development

```bash
npm install --legacy-peer-deps
cp .env.example .env
# fill in MONGODB_URI

npm run dev          # http://localhost:8787
npm run seed         # seed demo workspace + demo user
```

Bootstrap the demo data on first start:

```bash
curl -X POST http://localhost:8787/auth/bootstrap
# -> seeds DevCollab HQ workspace + demo@devcollab.dev / demodemo
```

## Deployment (Vercel)

1. Push this repo to GitHub
2. Create a new Vercel project pointing at it (root = repo root)
3. Set the env vars below in the Vercel project settings
4. Deploy

`vercel.json` already wires every path to the single `api/index.ts` function — no extra config needed.

## Environment

| Name                    | Required | Description                                                                                                                |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`           | yes      | MongoDB Atlas connection string (SRV format).                                                                              |
| `ALLOWED_ORIGINS`       | yes      | Comma-separated allow-list for CORS. Localhost ports are always allowed.                                                   |
| `APP_BASE_URL`          | rec.     | Public URL of this backend (used in OAuth callbacks).                                                                      |
| `FRONTEND_BASE_URL`     | rec.     | Public URL of the React frontend (used to redirect back after OAuth).                                                      |
| `SESSION_COOKIE_DOMAIN` | optional | Pin the session cookie to a parent domain (e.g. `.devcollab.app`).                                                         |
| `OPENAI_API_KEY`        | optional | Enables real LLM responses for `/ai`. Without it, deterministic mock output is returned.                                   |
| `OPENAI_MODEL`          | optional | Override the model (default `gpt-4o-mini`).                                                                                |
| `AI_BASE_URL`           | optional | Override the API base for OpenAI-compatible providers.                                                                     |
| `GITHUB_CLIENT_ID`      | optional | GitHub OAuth app client ID.                                                                                                |
| `GITHUB_CLIENT_SECRET`  | optional | GitHub OAuth app client secret.                                                                                            |
| `GITHUB_WEBHOOK_SECRET` | optional | Shared secret for verifying inbound `/webhooks/github` payloads.                                                           |
| `SLACK_CLIENT_ID`       | optional | Slack OAuth app client ID.                                                                                                 |
| `SLACK_CLIENT_SECRET`   | optional | Slack OAuth app client secret.                                                                                             |
| `NOTION_CLIENT_ID`      | optional | Notion OAuth integration client ID.                                                                                        |
| `NOTION_CLIENT_SECRET`  | optional | Notion OAuth integration client secret.                                                                                    |

## Routes

| Path                                  | Method         | Description                                                                  |
| ------------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| `/health`                             | GET            | Liveness probe                                                               |
| `/auth/bootstrap`                     | POST           | Seeds the demo workspace + demo user (idempotent)                            |
| `/auth/signup`                        | POST           | Create a new account                                                         |
| `/auth/login`                         | POST           | Email + password login, sets `devcollab_session` cookie                      |
| `/auth/logout`                        | POST           | Clears the session                                                           |
| `/auth/me` / `/auth/me/full`          | GET            | Current user (lightweight / full)                                            |
| `/auth/profile`                       | PATCH          | Update profile (name, bio, avatar, skills, github)                           |
| `/auth/password`                      | POST           | Change password                                                              |
| `/workspaces` / `/workspace/summary`  | GET            | List workspaces / dashboard summary                                          |
| `/workspace/members`                  | GET            | List active workspace members                                                |
| `/workspace/members/:userId`          | PATCH / DELETE | Change role / remove member                                                  |
| `/workspace/invites`                  | GET / POST     | List / create invites                                                        |
| `/invites/accept`                     | POST           | Accept an invite by token                                                    |
| `/projects` / `/projects/:idOrSlug`   | CRUD           | Project CRUD (slug or id)                                                    |
| `/projects/:idOrSlug/tasks`           | GET / POST     | List / create tasks                                                          |
| `/tasks/:id`                          | PATCH / DELETE | Update / delete a task                                                       |
| `/tasks/:id/comments`                 | GET / POST     | Task comments (with @mention → notifications)                                |
| `/tasks/:id/attachments`              | GET / POST     | Attachments                                                                  |
| `/projects/:idOrSlug/wiki`            | GET / POST     | List / create wiki pages                                                     |
| `/wiki/:id` / `/wiki/:id/versions`    | CRUD + history | Wiki CRUD, versions, revert                                                  |
| `/projects/:idOrSlug/snippets`        | GET / POST     | Code snippets                                                                |
| `/snippets/:id`                       | PATCH / DELETE | Snippet update / delete                                                      |
| `/activity` / `/search?q=...`         | GET            | Activity feed + cross-resource search                                        |
| `/notifications` + `/.../read`        | GET / POST     | Notification list + mark read                                                |
| `/ai`                                 | POST           | Run an AI task (summary, explain, standup, refactor, code-review, etc.)      |
| `/billing` + `/billing/checkout`      | GET / POST     | Tier + usage / sandbox checkout                                              |
| `/projects/:idOrSlug/presence`        | GET / POST     | Presence heartbeat + active peers                                            |
| `/integrations` + GitHub/Slack/Notion | GET / POST     | OAuth + repo/channel/page linking                                            |
| `/webhooks/github`                    | POST           | HMAC-verified inbound webhook                                                |

All routes except `/health`, `/auth/*`, `/webhooks/*`, and OAuth callbacks require a valid session cookie.

## Notes on cookies

- Same-site dev (`http://localhost:8080` ↔ `http://localhost:8787`): `SameSite=Lax`.
- Production cross-origin: the auth module detects cross-origin requests and switches to `SameSite=None; Secure`.
- If frontend + backend share a parent domain, set `SESSION_COOKIE_DOMAIN=.yourdomain.com`.
