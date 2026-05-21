# Render DB Migration Runbook

This runbook describes the practical database migration path from Railway Postgres to Render Postgres for Optionyze.

Use this together with:

- `RENDER_PHASE1_MIGRATION_CHECKLIST.md`
- `RENDER_ENV_VAR_INVENTORY.md`
- `RENDER_PRIMARY_RAILWAY_STANDBY_PLAN.md`

## Goal

- move the primary Optionyze database from Railway to Render
- preserve current application data
- reduce cutover risk
- verify the app cleanly boots on Render against the migrated DB

## Migration Principle

For the first migration:

- treat Railway Postgres as `source`
- treat Render Postgres as `target`
- do a controlled export/import
- verify data before traffic cutover

Do not attempt app-level dual-write during this first DB migration.

## Critical Data To Preserve

Verify these survive migration:

- accounts / users
- bootstrap admin row
- Delta API profiles
- strategy profile/settings tables
- runtime state tables
- tracked open positions
- closed positions history
- pending strategy execution rows
- activity/event logs
- admin settings

## Phase A: Pre-Migration Preparation

Before export:

- choose a controlled migration window
- avoid unrelated deployments
- reduce live trading exposure if possible
- confirm Railway DB is healthy
- confirm Render Postgres is created and reachable

Checklist:

- Railway Postgres online
- Render Postgres online
- current app stable
- no active infrastructure incident

## Phase B: Capture Source DB Connection Details

From Railway source DB, record:

- host
- port
- database name
- username
- password
- full connection string

From Render target DB, record:

- host
- port
- database name
- username
- password
- full connection string

## Phase C: Export Railway Database

Preferred migration style:

- logical PostgreSQL dump

Recommended export content:

- schema
- data
- sequences
- indexes
- constraints

Try to avoid ad-hoc table-by-table copying unless absolutely necessary.

## Phase D: Import Into Render Postgres

Restore the exported Railway dump into Render Postgres.

After import, verify that:

- schema exists
- key tables exist
- row counts look plausible
- app-critical data is present

## Phase E: Post-Import Validation

Before app cutover, validate data directly in the target DB.

Minimum validation:

- admin account exists
- known user accounts exist
- Delta API profile rows exist
- strategy profile rows exist
- runtime rows exist
- event/activity rows exist
- pending strategy execution rows exist

Recommended validation method:

- compare a short list of critical row counts between Railway and Render

Examples:

- account count
- API profile count
- runtime row count
- activity log row count
- pending request count

## Phase F: App Boot Validation Against Render DB

Before redirecting production traffic:

- point a non-production Render app instance to Render Postgres
- boot the app
- confirm bootstrap succeeds

Validate:

- no `DATABASE_URL` connection errors
- no schema bootstrap failures
- login page loads
- admin login works
- `mngUsers` loads
- Dual page loads

## Phase G: Controlled Data Freshness Check

Because Railway may still receive activity before final cutover:

- minimize writes during the final migration window
- if needed, do one last refresh migration before the final switch

Safer cutover style:

1. reduce live usage
2. take final source export
3. import final delta into Render DB
4. switch app to Render DB

## Phase H: Production Cutover

When ready:

- set production app `DATABASE_URL` to Render Postgres
- set `PGSSLMODE` correctly for Render Postgres
- redeploy production app

After deploy:

- confirm app boots successfully
- confirm no DB timeout logs
- confirm no schema errors
- confirm users can sign in

## Phase I: Post-Cutover Validation

Immediately after cutover:

- user login works
- admin login works
- Delta API profiles load
- open positions page loads
- closed positions load
- activity log loads
- pending strategy executions load
- Telegram settings load

If live trading is being tested:

- test with one controlled user first

## Phase J: Stabilization Window

After cutover:

- monitor logs closely
- do not rush new infrastructure changes
- do not immediately delete Railway Postgres

Observe:

- app DB connection stability
- response times
- unexpected missing records
- runtime reconciliation issues

## Rollback Strategy

If Render DB cutover fails:

- keep Railway DB untouched
- restore production app `DATABASE_URL` back to Railway
- redeploy app back to known-good DB target

Rollback should be possible until you intentionally retire Railway as the primary DB.

## Things To Avoid

- do not delete Railway Postgres immediately after migration
- do not cut over without validation of critical tables
- do not mix infra migration with large feature deployments
- do not test with many live users first
- do not assume SSL settings are identical between Railway and Render

## Recommended Verification List

After migration, compare these between source and target:

- total accounts
- total Delta API profiles
- total strategy profile rows
- total runtime rows
- total tracked position rows
- total pending execution rows
- total event rows

Also verify a few specific records manually:

- bootstrap admin email
- one real user profile
- one known Dual runtime row
- one recent activity log row

## Recommended Next Step

After this runbook, the next operational work should be:

- prepare the exact migration commands and checklist for the chosen migration window

If we want to formalize that later, create:

- `RENDER_DB_CUTOVER_COMMANDS.md`
