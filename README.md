# FinanceOS

Personal finance + trip operating system. Track accounts, monthly budgets, and project spending (trips, weddings, work) in one ledger.

## Stack

- React 19, TypeScript, TanStack Start / Router / Query
- Tailwind CSS v4
- PostgreSQL (Neon in production, embedded Postgres in preview)
- Better Auth (Google, X, email/password)
- PWA via the platform web app manifest + service worker

Every query is scoped to the signed-in user. Financial amounts use `NUMERIC(14,2)` in the database and integer minor-units in application math.

## Local development

1. Install dependencies: `npm install`
2. Copy `migrations/auth/0001_auth.sql` to `migrations/0001_auth.sql` if it is not already there
3. Do **not** create a `.env` file in this workspace. Auth and `DATABASE_URL` are injected on deploy; preview uses an embedded database.
4. Start: `npm run dev` (binds `0.0.0.0:8080`)

## Database

Schema lives in `migrations/`:

- `0001_auth.sql` — Better Auth tables
- `0002_financeos.sql` — profiles, accounts, categories, projects, transactions, budgets, attachments

Migrations apply automatically on preview startup and during `npm run build` (`db:migrate`) against `DATABASE_URL`.

## Authentication

Sign-in methods: Google, X, and email/password.

After first sign-in the app creates a profile and default categories, then a short onboarding (name, currency, first account, optional monthly budget). Skip is allowed.

Configure the production callback URL to the deployed origin (`/api/auth/*`).

## PWA

The platform injects the web app manifest, icons, and service worker. Theme color is `#0c0c0d`. Add to Home Screen from the browser share sheet. The app shell is cached; unsent transaction drafts queue locally and sync when the network returns.

## Deploy

The production target is Vercel. Required environment (injected by the platform, not committed):

- `DATABASE_URL`
- Auth broker credentials

Build command: `npm run build` (includes migrations).

## Demo data

Settings → **Load demo data** creates a Bangalore Trip (`₹20,000`) with prepaid flight/hotel and a few on-trip expenses, plus a Crodlin project. **Remove demo data** deletes only rows marked as demo.
