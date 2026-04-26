# Enterprise Template

A Next.js 16 starter for building internal/enterprise apps. Comes wired with:

- **Auth.js v5** — credentials (email + password), Microsoft Entra ID (Azure AD), Google, Keycloak, SAML
- **RBAC** — roles + permissions, enforced by Next.js proxy middleware and server helpers
- **Prisma + Postgres** — users, accounts, sessions, roles, permissions, invitations
- **Authed app shell** — collapsible sidebar nav, top bar with theme toggle and user menu
- **Profile** — `/profile` lets users update their name and set/change their password (works for both credentials and SSO users)
- **Admin UI** — `/admin/users` (assign roles), `/admin/roles` (toggle permissions), `/admin/organization` (shareable invite links)
- **AI Workspace** — `/ai` interactive demo combining every showcase AI pattern (chatbot, structured flow, agent assist, voice, summary cards)
- **Showcase** — the original component gallery preserved at `/showcase/*`
- React 19, Tailwind CSS v4, Radix UI

## Default credentials

After running `npm run db:seed`, sign in at `/login` with:

| Email | Password |
| --- | --- |
| `admin@example.com` | `admin1234` |

Override before seeding by setting `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env`. **Change these before deploying anywhere reachable.**

## Bootstrap

Prerequisites: Node 20+, npm, Docker (or a local Postgres 14+).

### 1. Clone and install

```bash
git clone <your-fork-url> my-app
cd my-app
npm install
```

`postinstall` runs `prisma generate` automatically.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

- `AUTH_SECRET` — generate with `openssl rand -base64 32`
- `AUTH_URL` — defaults to `http://localhost:3000`
- `DATABASE_URL` — Postgres connection string (the default matches the bundled Docker Postgres)

Enable any SSO providers you want by uncommenting and filling in their env vars. Each provider is auto-enabled when its `*_CLIENT_ID` / `*_ENTRY_POINT` is present — no code changes needed. Redirect URIs to register with your IdP:

- OIDC providers: `${AUTH_URL}/api/auth/callback/<provider>` (`google`, `microsoft-entra-id`, `keycloak`)
- SAML ACS: `${AUTH_URL}/api/auth/saml/callback`

### 3. Start Postgres

Either use the bundled container:

```bash
docker compose up -d db
```

Or point `DATABASE_URL` at your own Postgres instance.

### 4. Migrate and seed

```bash
npm run db:migrate    # creates tables (prompts for a migration name on first run)
npm run db:seed       # creates roles, permissions, and default admin user
```

The seed creates:

- Roles: `admin` (all permissions), `member` (no permissions, auto-assigned to new SSO sign-ups)
- Permissions: `users:read`, `users:write`, `users:delete`, `roles:read`, `roles:write`, `invites:read`, `invites:write`
- Admin user: `admin@example.com` / `admin1234` (override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)

### 5. Run

```bash
npm run dev
```

Open http://localhost:3000 and sign in at `/login` with the seeded admin to access `/admin/users` and `/admin/roles`.

### Reset the database

```bash
npx prisma migrate reset    # drops, re-migrates, and re-seeds
```

### One-shot Docker bootstrap

To run the whole stack (Postgres + app) in containers:

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec app npx prisma migrate deploy
docker compose exec app npx tsx prisma/seed.ts
```

## Routes

| Route | Description |
| --- | --- |
| `/` | Public landing page |
| `/login` | Sign-in (credentials + enabled SSO providers, split-hero layout) |
| `/dashboard` | Authed home — shows your roles and permissions |
| `/profile` | Edit your name, set / change password, view linked sign-in methods |
| `/ai` | Interactive AI workspace using every showcase AI pattern |
| `/admin/users` | Manage users (requires `users:read` / `users:write`) |
| `/admin/roles` | Manage roles & permissions (requires `roles:read` / `roles:write`) |
| `/admin/organization` | Create and revoke invitation links (requires `invites:read` / `invites:write`) |
| `/invite/[token]` | Accept an invite link — auto-assigns the bound role on first sign-in |
| `/showcase/*` | Component gallery, design system, template previews |
| `/forbidden` | Shown when RBAC denies access |

## Auth providers

Each SSO provider is enabled only if its env vars are set. See `.env.example`.

- **Azure AD / Microsoft Entra ID** — `AUTH_AZURE_AD_CLIENT_ID`, `AUTH_AZURE_AD_CLIENT_SECRET`, `AUTH_AZURE_AD_TENANT_ID`
- **Google** — `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET`
- **Keycloak** — `AUTH_KEYCLOAK_CLIENT_ID`, `AUTH_KEYCLOAK_CLIENT_SECRET`, `AUTH_KEYCLOAK_ISSUER`
- **SAML** — `AUTH_SAML_ENTRY_POINT`, `AUTH_SAML_ISSUER`, `AUTH_SAML_IDP_CERT`. Implemented with `@node-saml/node-saml`. SP routes are at `/api/auth/saml/login` and `/api/auth/saml/callback`. For multi-tenant SAML, point a generic OIDC provider at [BoxyHQ Jackson](https://boxyhq.com/docs/jackson/overview) instead.

OAuth/OIDC redirect URI: `${AUTH_URL}/api/auth/callback/<provider>`. SAML ACS: `${AUTH_URL}/api/auth/saml/callback`.

## RBAC

Permissions follow the convention `<resource>:<action>` (e.g. `users:read`). Default seeded permissions:

- `users:read`, `users:write`, `users:delete`
- `roles:read`, `roles:write`
- `invites:read`, `invites:write`

Default seeded roles:

- `admin` — all permissions
- `member` — none (auto-assigned to new SSO sign-ups)

### Server helpers (`src/lib/rbac.ts`)

```ts
import { requireUser, requirePermission, requireRole, hasPermission } from "@/lib/rbac";

await requirePermission("users:write");
```

### UI guard (`src/components/auth/protected.tsx`)

```tsx
<Protected permission="users:write" fallback={<p>No access</p>}>
  <CreateUserButton />
</Protected>
```

### Middleware

`src/proxy.ts` (the Next.js 16 successor to `middleware.ts`) redirects unauthenticated requests to `/login`. Add new public paths to the `PUBLIC_PATHS` array.

## Database

Schema in `prisma/schema.prisma`. Common commands:

```bash
npm run db:migrate    # create + apply a new migration in dev
npm run db:deploy     # apply migrations in CI / prod
npm run db:seed       # seed roles, permissions, admin
npm run db:studio     # open Prisma Studio
```

## Docker

```bash
docker compose up --build
```

Brings up Postgres + the app. Set `AUTH_SECRET` in your environment first.

## Inviting users

Admins (or anyone with `invites:write`) can mint shareable sign-up links from `/admin/organization`:

- **Optional email binding** — leave blank to allow anyone with the link, or set an email so only that account may accept.
- **Optional pre-assigned role** — the role is granted automatically when the invite is consumed.
- **Configurable expiry** — defaults to 7 days, max 365.

A new invite copies its URL to the clipboard immediately. The invitee opens the link, signs in (or signs up via SSO), and is redirected to `/dashboard` with the role attached. Invites can be revoked at any time.

## AI Workspace

`/ai` is a working playground that exercises every AI component pattern from the showcase in one screen:

- Traditional chatbot with typing indicator
- Quick-action prompts (structured chatbot)
- Agent-assist suggestions that surface as you type keywords like `password`, `refund`, `ticket`
- Voice recording UI (waveform + timer) and per-message voice playback
- Inline AI summary card and AI-annotated metric (headless chatbot)
- Live knowledge-base highlighting based on the composer input
- Helpful / not-helpful feedback and source citations on every assistant message

The replies come from a `fakeAnswer()` stub in `src/app/(app)/ai/ai-workspace.tsx` — swap it for a real LLM call (e.g. an `/api/ai` route) when wiring up your backend.

## Showcase

The component gallery, design system, and template mocks from the original Scicom Design Hub are kept at `/showcase/*` for reference. Delete `src/app/showcase/` if you don't need them.

## Tech stack

- [Next.js 16](https://nextjs.org)
- [React 19](https://react.dev)
- [Auth.js v5](https://authjs.dev)
- [Prisma 6](https://www.prisma.io) + Postgres
- [Tailwind CSS v4](https://tailwindcss.com)
- [Radix UI](https://www.radix-ui.com)
