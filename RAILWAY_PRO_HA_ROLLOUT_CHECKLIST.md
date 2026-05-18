# Railway Pro And PostgreSQL HA Rollout Checklist

This note is for the next production-hardening step after the pilot phase.

Goal:

- move from Railway Hobby to Pro
- move PostgreSQL to Railway HA
- reduce platform and restart risk before scaling live users

## Recommended Timing

Upgrade before:

- more than `2-3` live users
- higher user capital exposure
- unattended multi-user live trading
- adding standby workers / failover automation

## Phase 1: Pre-Upgrade Preparation

### 1. Freeze risky app changes

Before infra changes:

- avoid deploying large new trading logic changes
- keep the app behavior stable for a few days if possible

### 2. Record current production state

Capture:

- current Railway plan
- current Railway services
- current database service details
- current environment variables
- current deployment start command
- app version / latest Git commit

Suggested record:

- Git commit hash
- Railway service names
- current `DATABASE_URL`

### 3. Verify database backup path

Before touching DB:

- confirm Railway backup availability
- confirm you know how to restore
- export a logical backup if possible

Minimum expectation:

- one recent backup exists
- restore procedure is understood

### 4. Review pilot health

Check before upgrade:

- restart count
- memory trend
- last cycle timestamps
- Delta connection failure frequency
- order failure frequency

If the app is already unstable, fix that first. Infra upgrade alone will not solve logic issues.

## Phase 2: Upgrade To Railway Pro

### 1. Upgrade account / project plan

Move from Hobby to Pro.

Reason:

- production-oriented usage
- better fit for live trading risk
- easier path for multi-service architecture

### 2. Re-check service limits and billing

After upgrade:

- confirm billing is active
- confirm service resource limits
- confirm database/service provisioning options now visible

## Phase 3: Move To Railway PostgreSQL HA

### 1. Create HA PostgreSQL target

Provision Railway PostgreSQL HA.

Do not destroy the old DB first.

### 2. Plan migration window

Choose a quiet period:

- minimal live user activity
- preferably no fresh entries opening
- ideally all users informed

### 3. Put live trading in safe mode

Before cutover:

- disable fresh entries
- stop auto trader for live users if appropriate
- make sure no pending high-risk order action is in progress

Best case:

- no live positions open during final cutover

If live positions still exist:

- pause automation
- verify tracked DB positions and Delta positions match

### 4. Migrate database

Recommended order:

1. take backup of old DB
2. restore / migrate data into HA DB
3. verify key tables and row counts
4. update `DATABASE_URL`
5. redeploy services

### 5. Verify critical tables

At minimum verify:

- accounts
- delta api profiles
- rolling futures profiles
- rolling futures runtime
- tracked positions
- pending strategy execution requests
- auto-exec settings

## Phase 4: Post-Cutover Verification

### 1. Application startup checks

Verify:

- app starts cleanly
- DB connects successfully
- admin login works
- user login works

### 2. Strategy page checks

Verify on live strategy pages:

- profile loads
- runtime loads
- connection check works
- open positions load
- event log loads

### 3. Pending execution queue checks

Verify:

- pending requests are visible in `MngUsers`
- execute action works
- cancel action works
- auto-exec settings load and save

### 4. End-to-end Delta checks

Run controlled low-risk tests:

- connection test
- manual read-only status checks
- one small test order if safe
- one small close flow if safe

### 5. Compare DB vs Delta truth

For each pilot user:

- verify runtime state
- verify tracked positions
- verify actual Delta positions

No mismatch should remain after cutover.

## Phase 5: Monitoring After Upgrade

For at least `3-7` days after migration, watch:

- Railway restart count
- memory growth
- last cycle timestamps
- DB connection errors
- Delta connection failures
- order failure events

## Suggested Rollout Sequence

### Safer sequence

1. Upgrade to Railway Pro
2. Keep current DB briefly
3. Observe for `1-3` days
4. Then migrate to Railway PostgreSQL HA

This separates plan-change risk from DB-migration risk.

### Faster sequence

1. Upgrade to Pro
2. Provision HA DB
3. Migrate during a quiet window
4. Redeploy and verify

Use this only if you are comfortable with the cutover process.

## Recommended Operational Rules During Rollout

- avoid cutover during volatile market hours
- avoid cutover when multiple users have active live positions
- prefer tiny-position validation first
- keep Telegram / admin monitoring active throughout

## Minimum Rollback Plan

Prepare this before cutover:

1. old DB still available
2. old `DATABASE_URL` saved
3. previous working Git commit known
4. rollback decision threshold defined

Rollback if:

- login fails
- runtime data missing
- positions mismatch Delta
- repeated DB connection errors
- pending execution queue broken

## Next Implementation After Pro + HA

After successful upgrade:

1. leader lease table
2. worker leader / follower model
3. per-strategy DB locks
4. startup reconciliation
5. stale-cycle watchdog

These are described in:

- `FAILOVER_AND_TRADING_SAFETY_DESIGN.md`

## Quick Go-Live Checklist

Before calling rollout complete:

- Pro plan active
- HA Postgres active
- app connected to new DB
- admin page working
- live strategy pages working
- pending queue working
- auto-exec settings working
- no DB/Delta mismatch
- monitoring checklist ready
