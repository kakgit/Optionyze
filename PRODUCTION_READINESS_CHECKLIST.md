# Production Readiness Checklist

This note is the short execution-order version of the two detailed documents:

- `FAILOVER_AND_TRADING_SAFETY_DESIGN.md`
- `RAILWAY_PRO_HA_ROLLOUT_CHECKLIST.md`

Use this as the practical rollout sequence.

## Current Phase

Current recommendation:

- run pilot with `2-3` users only
- keep close monitoring active
- do not scale user exposure yet

## Pilot Monitoring Checklist

Watch daily:

- Railway restart count
- Railway memory growth
- per-user `lastCycleAt`
- Delta connection failures
- order failure events

If any of these become noisy or unstable, pause scaling.

## Step 1: Stabilize Pilot

Before infrastructure changes:

- keep trading logic stable
- avoid large feature deployments
- verify pending execution queue works
- verify Dual auto execution behavior works
- verify admin controls work

## Step 2: Upgrade Railway Plan

Move:

- `Hobby -> Pro`

Reason:

- better production fit
- better base for multi-service setup
- better fit for live trading risk

## Step 3: Move To Railway PostgreSQL HA

Do this before scaling users materially.

Checklist:

- backup current DB
- provision Railway PostgreSQL HA
- choose quiet migration window
- pause risky live actions
- migrate DB
- update `DATABASE_URL`
- redeploy services
- verify DB vs Delta state

Detailed steps:

- see `RAILWAY_PRO_HA_ROLLOUT_CHECKLIST.md`

## Step 4: Re-Verify Production Basics

After Pro + HA:

- admin login works
- user login works
- live strategy pages load
- Delta connection check works
- open positions load correctly
- pending strategy queue works
- auto-exec settings work

## Step 5: Implement Trading Failover

Next engineering milestone:

- leader lease table
- worker leader/follower model
- per-strategy DB locks
- startup reconciliation on takeover
- stale-cycle watchdog

Detailed design:

- see `FAILOVER_AND_TRADING_SAFETY_DESIGN.md`

## Step 6: Move To Multi-Worker Setup

Recommended target:

- one web service
- two worker services
- one shared PostgreSQL HA database

Safer long-term version:

- worker A on Railway
- worker B on another provider

## Step 7: Add Safety Visibility

Before scaling beyond pilot:

- add admin health panel
- show stale-cycle warnings
- show Delta connectivity state
- alert on critical failures through Telegram

## Step 8: Scale Carefully

Only increase user count when:

- restart behavior is stable
- memory trend is stable
- no recurring Delta/order failures
- DB migration is complete
- failover design is at least partially implemented

## Suggested Timeline

### Now

- pilot with `2-3` users
- monitor closely

### Soon

- Railway Pro
- Railway PostgreSQL HA

### Next

- leader/follower worker failover
- stale-cycle watchdog

### After That

- scale users and capital more confidently

## Stop Conditions

Pause rollout or scaling if:

- repeated Railway restarts
- rising memory without explanation
- stale `lastCycleAt`
- Delta disconnection bursts
- close-order failures
- DB/Delta position mismatch

## Final Readiness Rule

Do not scale beyond pilot until:

- Pro plan active
- PostgreSQL HA active
- monitoring is in place
- failover implementation is planned and scheduled
