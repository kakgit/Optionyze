# Render Environment Variable Inventory

This note records the environment variables currently used by Optionyze so the Render migration can be configured safely.

Use this together with:

- `RENDER_PHASE1_MIGRATION_CHECKLIST.md`
- `RENDER_PRIMARY_RAILWAY_STANDBY_PLAN.md`

## Current Build / Start Commands

From `railway.json`:

- build command: `npm run build`
- start command: `npm start`

These should be mirrored on Render unless intentionally changed.

## Runtime Environment Variables In Use

Based on current code usage, Optionyze actively reads these environment variables:

### Database

- `DATABASE_URL`
  - used for PostgreSQL connection
  - required in production

- `PGSSLMODE`
  - affects PostgreSQL SSL behavior
  - current code treats `disable` specially

### Server

- `PORT`
  - used by the Node server for binding
  - Render usually injects its own port automatically

- `NODE_ENV`
  - affects secure cookie handling
  - production should use `production`

### Bootstrap Admin

- `BOOTSTRAP_ADMIN_NAME`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_MOBILE`

These are used by the bootstrap admin account logic.

### Telegram

- `TELEGRAM_BOT_TOKEN`
  - used by Telegram event / alert flows

## Files Where These Are Used

### Database / Server

- [server.ts](D:/NodeJS/Optionyze/src/app/server.ts:51)
- [postgres.ts](D:/NodeJS/Optionyze/src/storage/postgres.ts:41)
- [auth-middleware.ts](D:/NodeJS/Optionyze/src/api/middleware/auth-middleware.ts:120)

### Bootstrap Admin

- [accounts-store.ts](D:/NodeJS/Optionyze/src/storage/accounts-store.ts:7)

### Telegram

- [account-controller.ts](D:/NodeJS/Optionyze/src/api/controllers/account-controller.ts:76)
- [auth-controller.ts](D:/NodeJS/Optionyze/src/api/controllers/auth-controller.ts:106)
- [rolling-futures-lt-controller.ts](D:/NodeJS/Optionyze/src/api/controllers/rolling-futures-lt-controller.ts:3314)
- [rolling-options-lt-de-controller.ts](D:/NodeJS/Optionyze/src/api/controllers/rolling-options-lt-de-controller.ts:229)
- [rolling-options-lt-de event logger](D:/NodeJS/Optionyze/src/strategies/rolling-options-lt-de/event-logger.ts:36)
- [rolling-options-pt-de event logger](D:/NodeJS/Optionyze/src/strategies/rolling-options-pt-de/event-logger.ts:47)

## Recommended Render Variable Set

### Required

- `DATABASE_URL`
- `PGSSLMODE`
- `NODE_ENV=production`
- `TELEGRAM_BOT_TOKEN`

### Strongly Recommended

- `BOOTSTRAP_ADMIN_NAME`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_MOBILE`

### Usually Not Needed To Set Manually

- `PORT`

Render normally injects the port automatically, and the app already reads `process.env.PORT`.

## Production Notes For Render

### 1. `PGSSLMODE`

If Render Postgres requires SSL in the chosen setup, do not leave:

- `PGSSLMODE=disable`

Review the actual Render Postgres connection requirements before cutover.

### 2. `NODE_ENV`

Set:

- `NODE_ENV=production`

This matters for secure cookie behavior.

### 3. Secrets Handling

Do not hardcode production secrets in repo files.

Set sensitive values only in Render environment variables:

- DB URL
- Telegram bot token
- admin password

## Pre-Cutover Env Checklist

Before first Render production boot:

- `DATABASE_URL` points to Render Postgres
- `PGSSLMODE` matches Render DB requirements
- `NODE_ENV=production`
- `TELEGRAM_BOT_TOKEN` is set
- bootstrap admin values are set intentionally
- build command is `npm run build`
- start command is `npm start`

## Recommended Next Note

After this inventory, the next operational note should be:

- `RENDER_DB_MIGRATION_RUNBOOK.md`

That runbook should capture:

- how to export Railway Postgres
- how to import into Render Postgres
- what to verify before cutover
