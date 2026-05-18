# Failover And Trading Safety Design

This note captures the next implementation for making live trading safer when Railway, the worker process, or Delta Exchange connectivity becomes unstable.

## Goal

- Prevent unmanaged live positions when one server or platform fails
- Avoid duplicate trading actions during failover
- Resume safely after restart or takeover

## Proposed Architecture

### Services

- `Web Server`
  - UI + APIs only
  - does not run live strategy loops
- `Worker A`
  - live strategy engine
  - can become leader
- `Worker B`
  - standby live strategy engine
  - can take over if leader fails

### Shared Database

All workers and web services use the same PostgreSQL database.

Persist in DB:

- strategy runtime state
- tracked open positions
- pending execution requests
- auto-exec settings
- leader lease
- per-strategy execution locks
- health / stale-cycle timestamps

## Leader / Failover Model

Use `active-passive`, not active-active.

Only one worker is allowed to execute:

- auto trader cycles
- SL / TP handling
- pending strategy auto-execution
- any new live order automation

The other worker stays warm and monitors the leader lease.

## DB Tables To Add

### 1. `optionyze_system_leader_lease`

Purpose:

- one global lease for the live trading engine

Suggested columns:

- `lease_name TEXT PRIMARY KEY`
- `leader_id TEXT NOT NULL`
- `lease_until TIMESTAMPTZ NOT NULL`
- `last_heartbeat TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Use lease name:

- `live_trading_worker`

### 2. `optionyze_strategy_execution_locks`

Purpose:

- prevent duplicate processing per `userId + strategyCode`

Suggested columns:

- `lock_key TEXT PRIMARY KEY`
- `owner_id TEXT NOT NULL`
- `lease_until TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Suggested lock key:

- `${userId}::${strategyCode}`

### 3. Optional `optionyze_system_events`

Purpose:

- leader change audit trail
- failover diagnostics

## Timing Recommendation

- leader lease duration: `15 seconds`
- leader heartbeat renewal: every `5 seconds`
- strategy lock duration: `20 to 30 seconds`
- stale cycle warning: `> 60 seconds without cycle`

## Worker Behavior

### On Startup

1. Generate a unique `server_id`
2. Start leader-election loop
3. If leader acquired:
   - load all `running` live runtimes
   - reconcile DB positions with Delta
   - restart live monitoring safely

### While Leader

- renew leader lease periodically
- before each scheduler tick, confirm lease is still valid
- before processing a strategy, acquire per-strategy DB lock

### While Follower

- do not run trading loops
- monitor leader lease
- take over only if lease expires

## Safety Rules

### Reconcile First, Trade Second

On leader takeover:

1. load runtime from DB
2. fetch live positions from Delta
3. repair mismatches
4. only then resume automation

### No New Entries In Degraded State

When Delta connectivity is unhealthy:

- do not open fresh positions
- allow only risk-reducing / close logic when safe
- mark runtime as degraded
- notify admin / users

### Idempotency

Every order flow should tolerate:

- request sent but response lost
- retry after timeout
- process restart in the middle of execution

Required behavior:

- persist action intent before order placement where needed
- reconcile with Delta before retrying after uncertain outcome
- do not assume timeout means no order was placed

## Health / Alerting

Track and surface:

- current leader id
- last leader heartbeat
- worker last cycle time
- stale strategy count
- Delta connection status
- last execution error

Send alerts for:

- no leader heartbeat
- stale live strategy cycle
- Delta connection degraded
- SL / close order failure
- failover event

## Deployment Recommendation

### Minimum Safe Version

- one web service
- two worker services
- one shared PostgreSQL
- DB-backed leader lease
- DB-backed strategy locks

### Better Version

- web service on Railway
- worker A on Railway
- worker B on another provider / VPS
- shared PostgreSQL with strong backups

This reduces platform-level single-point failure risk.

## Database Recommendation

If the database stays on Railway:

- use PostgreSQL HA if available for production
- enable backups
- add external backup verification if possible

If the goal is surviving a Railway-wide outage:

- move PostgreSQL to an external managed provider
- keep workers/web free to fail over independently of Railway

## Implementation Order

1. Add leader lease table + helpers
2. Add per-strategy DB lock table + helpers
3. Move trading scheduler under leader-only worker process
4. Add startup reconciliation on worker takeover
5. Add stale-cycle watchdog + alerts
6. Add degraded / safe-mode behavior
7. Move standby worker to second platform

## Important Principle

Never allow two independent servers to trade live user strategies at the same time.

Failover must always be:

- one leader
- one follower
- DB-coordinated
- short lease based
