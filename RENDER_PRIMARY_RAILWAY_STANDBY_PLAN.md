# Render Primary / Railway Standby Plan

This note captures the phased rollout plan for moving Optionyze away from an all-in-Railway production dependency after the Railway outage.

## Goal

- reduce single-provider outage risk
- keep the first move affordable
- avoid unsafe active-active trading workers
- move toward a controlled failover design in phases

## Target Direction

Recommended long-term shape:

- `Primary DB`: Render Postgres
- `Primary App`: Render
- `Primary Worker`: Render
- `Standby Worker`: Railway
- `One shared DB`
- `One active trading leader at a time`

Detailed execution note for the first migration:

- `RENDER_PHASE1_MIGRATION_CHECKLIST.md`

Important rule:

- never run both Render and Railway workers as active trading engines at the same time

## Why This Direction

The recent outage showed the main current risk:

- app and DB were both on Railway
- one provider incident affected both
- live trading supervision stopped

This phased plan reduces that risk without forcing a large enterprise-grade setup immediately.

## Phase 1: Minimum Render Migration

Goal:

- move the main production home off Railway
- keep cost and complexity controlled

Recommended setup:

- `Render Pro workspace`
- `Render main app`
- `Render main worker`
- `Render normal Postgres`
- keep Railway only as the current backup platform for now

Why:

- quickest serious reduction in single-platform risk
- simpler than adding failover and HA all at once
- easier migration path for the current small user base

Notes:

- this phase does not yet provide DB automatic failover
- this phase does not yet provide standby worker takeover

## Phase 2: Add Railway Standby Worker

Goal:

- reduce the risk of the primary worker going down for too long

Recommended setup:

- keep Render as primary app + primary worker
- keep Render DB as the single source of truth
- add one Railway standby worker
- both workers connect to the same Render database

Required engineering:

- `optionyze_system_leader_lease`
- `optionyze_strategy_execution_locks`
- worker heartbeat
- stale-cycle watchdog
- startup reconciliation after takeover

Important behavior:

- Render worker normally holds leader lease
- Railway worker stays warm and idle
- Railway worker takes over only if leader lease expires

## Phase 3: Upgrade Render DB To HA

Goal:

- improve primary database availability

Recommended setup:

- move Render Postgres to `HA`
- keep the same primary/standby worker model

Important Render HA notes:

- HA requires an eligible `Pro` or `Accelerated` DB instance type
- HA standby has the same instance type and storage as primary
- HA standby is billed accordingly
- automatic failover can lose a small number of the most recent writes because replication is asynchronous

Implication for Optionyze:

- always reconcile DB state against Delta after restart or failover

## Phase 4: Dedicated Outbound IPs

Goal:

- stabilize Delta Exchange allowlisting

Important Render note:

- Render dedicated outbound IPs require `Pro` or higher
- Render uses a set of `3` static outbound IPv4 addresses per dedicated IP set
- a service can use any IP in that set

Operational implication:

- confirm Delta Exchange can whitelist all required Render outbound IPs
- if Delta allows only one IP, this needs special review before relying on Render as primary outbound platform

## Recommended Order

1. move app + DB to Render without HA first
2. confirm live trading works cleanly on Render
3. add Railway standby worker
4. implement leader/follower failover logic
5. upgrade Render DB to HA
6. add dedicated outbound IPs if required for Delta allowlisting

## What To Avoid

- do not keep app and DB on Railway as the only production setup
- do not run Render worker and Railway worker as active-active traders
- do not rely on manual failover once user count and capital exposure grow
- do not assume DB failover alone is enough without worker failover

## Current Recommendation

For the current stage and user base:

- start with `Phase 1`
- begin engineering work for `Phase 2`
- move to `Phase 3` after the primary Render deployment is stable

This gives the best balance of:

- safety improvement
- cost control
- migration complexity
