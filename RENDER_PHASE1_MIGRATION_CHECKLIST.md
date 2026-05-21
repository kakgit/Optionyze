# Render Phase 1 Migration Checklist

This note converts `Phase 1` from `RENDER_PRIMARY_RAILWAY_STANDBY_PLAN.md` into an execution checklist.

## Phase 1 Goal

- move the primary Optionyze app off Railway
- move the primary database off Railway
- keep the design simple for the first migration
- do not introduce standby-worker failover yet

Target for Phase 1:

- `Render Pro workspace`
- `Render primary web/app service`
- `Render primary worker service`
- `Render primary Postgres`

Railway remains available during migration, but should stop being the long-term primary home after cutover.

## Success Criteria

Phase 1 is complete when:

- users can log in on Render-hosted Optionyze
- Dual/Long pages load normally
- Delta API connectivity works from Render
- live trading can run from Render
- Postgres data is hosted on Render
- Railway is no longer the primary production runtime

## Step 1: Freeze Current Baseline

Before any migration:

- confirm current Railway app is healthy
- confirm current Railway Postgres is healthy
- avoid making unrelated feature changes
- avoid deploying non-essential UI changes
- identify a low-risk migration window

Checklist:

- app login works
- `mngUsers` loads
- Dual page loads
- Delta `Check Connection` works
- at least one known user profile can load correctly

## Step 2: Prepare Render Workspace

Create or verify:

- `Render Pro workspace`
- correct owner/team access
- billing enabled

Decide initial service names:

- `optionyze-web`
- `optionyze-worker`
- `optionyze-postgres`

## Step 3: Prepare App Inventory

Before creating services, collect all runtime settings from Railway:

- `DATABASE_URL`
- session/auth secrets
- bootstrap admin env vars
- Telegram bot/token env vars
- Delta/API-related env vars
- any feature flags
- port/start command assumptions

Make a migration list of every env var currently used by the app.

## Step 4: Create Render Postgres

Create a normal Render Postgres instance first.

Do not enable HA in Phase 1 unless budget and timing are already comfortable.

Checklist:

- database service created
- connection details copied
- region chosen intentionally
- backups enabled if available on selected setup

Record:

- internal DB host
- port
- database name
- username
- password
- connection URL

## Step 5: Migrate Database Data

Move data from Railway Postgres to Render Postgres.

Preferred approach:

- create a DB dump from Railway
- restore it into Render Postgres

Checklist:

- users/accounts restored
- API profiles restored
- strategy profiles restored
- runtime tables restored
- tracked positions restored
- pending strategy execution rows restored
- event/activity tables restored
- admin settings restored

After restore:

- verify row counts on critical tables
- verify latest users/events exist

## Step 6: Create Render Web Service

Create the main Render web/app service.

Use the same repo and branch as production.

Configure:

- build command
- start command
- environment variables
- new `DATABASE_URL` pointing to Render Postgres

Checklist:

- service builds successfully
- service starts successfully
- app binds to Render port correctly
- no DB bootstrap errors in logs

## Step 7: Create Render Worker Service

Create a separate worker service for the trading engine.

Even if worker separation is still minimal in the code today, create the service now so the architecture starts moving in the right direction.

Initial Phase 1 goal:

- keep only one production engine active
- do not let both Railway and Render run live trading loops simultaneously

Checklist:

- worker service builds successfully
- worker service starts successfully
- DB connection works
- logs are clean

## Step 8: Verify Render Delta Connectivity

Before cutover, verify:

- Delta API access works from Render
- allowlist/IP behavior is acceptable
- page-level connection checks succeed

Checklist:

- Dual page `Check Connection` works
- Delta account summary loads
- open positions can load
- no IP rejection errors

If Delta allowlisting is required:

- pause and confirm whether Render outbound IP model works for your Delta setup

## Step 9: Controlled Functional Testing On Render

Test in Render before switching real users.

Minimum testing:

- admin login
- user login
- load `mngUsers`
- load Dual page
- load Long page
- refresh open positions
- refresh closed positions
- activity log load
- Telegram selection load
- pending strategy execution table load

Live-trading safety testing:

- one controlled test user only
- confirm strategy start
- confirm runtime values update
- confirm logs/events update
- confirm no duplicate worker behavior

## Step 10: Cutover Plan

Choose a controlled cutover window.

Before cutover:

- stop new risky testing on Railway
- make sure DB on Render is current
- ensure only Render will be used as primary after the switch

At cutover:

- route production usage to Render app
- stop Railway from being the active production trading engine
- watch logs closely

Checklist:

- browser traffic reaches Render app
- DB writes go to Render Postgres
- no boot loops
- no Delta IP errors

## Step 11: Post-Cutover Validation

After cutover, verify:

- user login works
- admin login works
- critical pages work
- live positions load
- manual trader controls load
- pending queue works
- Telegram settings load
- no DB timeout errors

Observe for a period before scaling:

- memory usage
- restart count
- app logs
- worker logs
- connection warnings

## Step 12: Railway Role After Phase 1

After Render cutover:

- Railway should no longer be the primary production home
- Railway can remain available temporarily as fallback infrastructure
- do not allow both Railway and Render to run live trading engines actively at the same time

This prepares for `Phase 2`, where Railway becomes the formal standby worker provider.

## Things To Avoid In Phase 1

- do not move app and DB and failover logic all at once in one rushed cut
- do not leave both providers actively trading the same users
- do not enable standby logic before leader-lock design exists
- do not start with many live users on day one after migration

## Recommended Phase 1 Order

1. create Render workspace
2. create Render Postgres
3. migrate DB data
4. create Render web service
5. create Render worker service
6. verify Delta connectivity from Render
7. test with one controlled user
8. cut over primary production traffic
9. monitor closely

## Next Document After Phase 1

After completing this note, use:

- `RENDER_PRIMARY_RAILWAY_STANDBY_PLAN.md`

Then begin detailed planning for:

- `Phase 2: Railway standby worker`
- leader lease
- per-strategy execution locks
- failover safety
