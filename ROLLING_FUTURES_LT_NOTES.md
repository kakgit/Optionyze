# Rolling Futures LT Notes

This note captures the current behavior, design decisions, and important implementation details for:

- `rolling-futures-lt-long`
- `rolling-futures-lt-short`

These two pages share the same core controller/JS architecture and are intended to stay mirrored unless a change is explicitly strategy-specific.

## Main Files

- View:
  - `src/views/rolling-futures-lt-long.ejs`
  - `src/views/rolling-futures-lt-short.ejs`
- Frontend JS:
  - `public/js/rolling-futures-lt.js`
- Controller:
  - `src/api/controllers/rolling-futures-lt-controller.ts`
- Storage:
  - `src/storage/rolling-futures-lt-store.ts`
  - `src/storage/rolling-futures-lt-runtime-store.ts`
- Routes:
  - `src/api/routes/index.ts`

## Core Behavior

### Server-Side Auto Trader

- Live futures auto-trader runs on the server, not in the browser.
- Browser can be closed and the strategy can continue running.
- Server restart recovery is implemented:
  - saved runtime rows are loaded on startup
  - running auto-trader cycles are resumed
- A restart protection window exists to avoid immediate unsafe close actions right after recovery.

### Runtime Persistence

- Runtime state is persisted in DB.
- Important live values such as recovery totals and auto-trader state survive refresh/browser close.

## Neutrality Modes

### Enabled Modes

- `Only Delta Neutral`
- `Range Delta Neutral`
- `Gamma-Aware Delta Neutral`

### Removed Mode

- `Theta Delta Neutral` was removed completely from:
  - UI
  - shared JS
  - backend logic

### Only Delta Neutral

- Works as `% drift from hedged-zero baseline`.
- After futures hedge is placed, baseline net delta is treated as `0`.
- Server stores base option delta magnitude.
- Drift is calculated as:
  - `currentNetDelta / baseOptionDeltaAbs * 100`
- `- Delta` and `+ Delta` are interpreted as negative/positive drift percentage thresholds.
- Example safe start:
  - `-25 / +25`

### Range Delta Neutral

- Uses `- Delta` and `+ Delta` as absolute live net-delta band limits.
- Hedge triggers only when current net delta leaves that band.
- Example safe start:
  - `-3 / +3`

### Gamma-Aware Delta Neutral

- Uses the same drift-baseline model as `Only Delta Neutral`
- Tightens effective allowed band as gamma rises
- Reuses `- Delta / + Delta` as percentage thresholds
- Example safe start:
  - `-30 / +30`

### Hedge Cooldown

- A hedge cooldown timer is implemented server-side.
- After a neutrality hedge is placed, another hedge is blocked for 2 minutes.
- This applies to the active neutrality logic to reduce hedge churn.

## Option Entry / Re-entry Logic

### Single Option Rule

- Live futures pages are intended to keep only one option position open at a time.
- `Legs = both` is blocked for live futures entry.

### Option Contract Selection

- `New D` and `Re D` do not require an exact match.
- Contract finder chooses the best eligible option with:
  - `abs(delta) <= configured target delta`

### SL / TP Sequence

If option `SL D` or `TP D` is hit:

1. close the option first
2. if `Re Enter` is checked, open replacement option using `Re D`
3. then re-run neutrality logic
4. then add/reduce futures hedge if needed

This order is intentional:

- option close
- optional option re-entry
- then futures adjustment

## Expiry Mode Behavior

Supported modes:

- Daily T+1
- Daily T+2
- Weekly
- Bi-Weekly
- Monthly
- Bi-Monthly

### Server-Side Expiry Rolling

Expiry recalculation exists server-side and browser-side.

It is intended for the **next option entry/re-entry**, not to close existing positions.

Current rolling behavior:

- Daily T+1:
  - changes after midnight
- Daily T+2:
  - changes after midnight
- Weekly:
  - rolls after midnight when within 4 days of Friday expiry
- Bi-Weekly:
  - rolls after midnight when within 1 week of Friday expiry
- Monthly:
  - rolls after midnight when within 2 weeks of next month Friday expiry
- Bi-Monthly:
  - rolls after midnight when within 1 month of next-to-next month Friday expiry

## PnL / Brokerage Tracking

### Total Brokerage to Recvr

- Stored server-side
- Loads back on page refresh/open
- Increases when tracked positions are opened/closed
- Can now be manually edited from the UI and saved back to server

### Total PnL

- Stored server-side
- Tracks realized PnL from closed positions
- Can now be manually edited from the UI and saved back to server

### Net PnL

- Server-side derived value
- Includes:
  - realized total PnL
  - current open-position total PnL
  - minus `Total Brokerage to Recvr`
- Resets to zero only when all tracked positions are closed and accumulators are reset

### Brokerage Rule Guard

- `Close All when Net Profit is > X of Brokerage` will not trigger if `Total Brokerage to Recvr` is effectively zero.
- Guard prevents accidental close on tiny positive `Net PnL` when brokerage base is missing.

## Close-All Rules

### Brokerage Target Rule

- Trigger condition:
  - `Net PnL >= Total Brokerage to Recvr * X`
- If triggered:
  - all tracked positions close
  - if `Re Enter` is checked, re-entry is scheduled after cooldown

### Blocked Margin Rule

- Trigger condition:
  - `Net PnL >= Blocked Margin * (X / 100)`
- `Blocked Margin` is pulled from Delta account summary
- If triggered:
  - all tracked positions close
  - if `Re Enter` is checked, re-entry is scheduled after cooldown

### Re-entry Cooldown

- Current cooldown after close-all re-entry:
  - 5 minutes

## Delta / Theta Display Rules

### Delta Display

For options:

- orange value:
  - current live delta × running qty
- grey value:
  - fixed base delta × running qty

For futures:

- futures delta is treated as:
  - `1 per lot`
- orange and grey values are based on this futures convention

### Theta Display

For options:

- orange value:
  - current live theta × contract size × qty
- grey value:
  - base theta × contract size × qty

For futures:

- theta is shown as zero

### Gamma / Vega

- Gamma and Vega columns were removed from the Open Positions table.

## Charges

### Option Brokerage

Option brokerage estimate was adjusted to match Delta’s fee model more closely:

1. `order notional = qty × lot size × underlying price`
2. `trading fee = order notional × 0.01%`
3. `premium cap = 3.5% × qty × lot size × option premium`
4. `effective fee = min(trading fee, premium cap)`
5. `total fee = effective fee × 1.18`

### Futures Brokerage

- Futures charge logic remains separate and unchanged from the option fee formula.

## Telegram Alerts

- Live futures pages save/load Telegram alert preferences.
- Live futures event logging path is wired to Telegram sending for selected event types.
- Some old alert types were intentionally removed from the UI:
  - `renko change detected`
  - `reentry opened`
  - `extra future added`
  - `manual action`

## Activity Log

- Activity log is stored server-side in DB.
- `Clear Activity Log` deletes DB rows only for that user + strategy.
- Individual event delete is supported.
- Current behavior:
  - individual delete: no confirmation
  - clear all: confirmation required

## UI / Layout Notes

### Open Positions Header

- Strategy badges are shown in the `Open Positions` header.
- Header tools/icons are pinned to the right even when badges are hidden.

### Timestamps

Date/time display format is:

- `DD-MM-YYYY HH:MM:SS`

Used in:

- Open Positions
- Closed Positions
- Activity Log
- Last Checked

## Local Development Notes

### Local DB Isolation

Local development should use a local Postgres DB, not the Railway DB.

Current local setup pattern:

- `DATABASE_URL=postgresql://...@localhost:5432/optionyze_local`
- `PGSSLMODE=disable`

Reason:

- if localhost and Railway share the same DB, local startup can recover live runtimes and interfere with production activity logs / strategy state

### Fresh DB Bootstrap Fix

Schema bootstrap order was fixed so a brand-new local DB can initialize correctly.

Specifically:

- `optionyze_accounts` must exist before tables that reference it via foreign keys.

## Known Follow-Up Ideas

These are good next-step improvements if needed later:

- minimum absolute delta filter for neutrality hedges
- reconcile/net futures state after hedge so app mirrors Delta’s netted position view more closely
- partial hedge logic instead of always full reset
- add strategy tagging via `client_order_id` for new Delta orders
- keep imported legacy positions tagged only app-side if Delta cannot retro-tag existing positions

## Important Operational Rule

- Do not run localhost and Railway against the same live DB/runtime when testing live futures.
- Keep local and production separated at the database level.
