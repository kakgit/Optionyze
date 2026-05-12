# Continue Next Time

## Run

From `D:\NodeJS\Optionyze`:

```powershell
npm run dev
```

Open:

- `http://localhost:3000/strategyfogreeks`
- `http://localhost:3000/api/health`

## Current Status

We started porting `StrategyFOGreeks` from `D:\NodeJS\AlgoMarti` into `Optionyze` as a **server-side paper trading system**.

What is already done:

- PostgreSQL-ready storage with JSON fallback
- runner state persistence
- server-side `StrategyFOGreeks` paper engine baseline
- per-user paper runner service
- server-rendered StrategyFOGreeks page
- profile storage for:
  - API key
  - API secret
  - Telegram bot token/chat id structure
  - UI state/config values
- login validation endpoint

Main files added/changed:

- `src/strategies/strategy-fo-greeks-paper/`
- `src/api/controllers/strategyfo-paper-controller.ts`
- `src/api/routes/index.ts`
- `src/app/server.ts`
- `src/storage/strategyfo-paper-profile-store.ts`
- `src/views/strategyfo-paper.ejs`
- `public/js/strategyfo-paper.js`

## Important Source Project

Browser-based stable source:

- `D:\NodeJS\AlgoMarti`

Main source files for parity:

- `views/StrategyFOGreeks.ejs`
- `views/partials/StrategyFOGreeksSettings.ejs`
- `public/js/StrategyFOGreeks.js`
- `public/js/StrategyFOGreeksSettings.js`
- `server/services/strategygreeks/`

## What Still Needs To Be Done

The current page is only a **baseline server-side version**. It is **not yet full parity** with the old page.

Still to port:

- full legacy page shell from `StrategyFOGreeks.ejs`
- settings modal parity
- manual trader controls
- all three config rows / leg selectors
- delta/theta neutrality controls
- Renko feed UI and server-side state
- directional spread presets
- trade mode / qty mode logic
- brokerage recovery controls
- open positions table parity
- closed positions table parity
- leg editor modal
- open position import/select modal
- payoff graph
- delta direction section
- legacy action buttons:
  - exec all legs

## Rolling Futures Live Note

Delta Exchange tagging research for `Long Rolling Futures` / `Short Rolling Futures`:

- Delta supports an order-level identifier using `client_order_id` at order creation time.
- Delta docs show lookup and cancel support by `client_order_id`.
- We did **not** find documented support to:
  - retro-tag an already open/fill-derived position
  - edit `client_order_id` later on an existing order
  - remove a tag from an existing position before removing it from our app
- Practical implication:
  - new live strategy orders can be tagged forward using `client_order_id`
  - already imported Delta positions cannot be safely retro-tagged through the API based on the docs checked
  - if we later implement strict live reconciliation after hedge netting, we should prefer:
    - Delta-side `client_order_id` for all new strategy orders
    - plus app-side ownership metadata for imported legacy positions

Current decision:

- save this note for later
- first observe how futures open/close/netting behaves in the current live setup
- if app behavior differs materially from Delta net positions, then implement tagging/reconciliation changes

## Rolling Futures Neutrality Follow-Up

Current `Only Delta Neutral` design in live futures:

- uses `% drift from hedged-zero baseline`
- this is kept as the main model because it scales across portfolio sizes

Already implemented:

- server-side `% drift` logic
- baseline reset after hedge
- server-side hedge cooldown timer
  - current cooldown: `2 minutes`

Recommended next improvements later:

1. Minimum absolute delta filter
- even if `% drift` is breached, do nothing unless absolute net delta is meaningful
- example idea:
  - hedge only if drift threshold is breached
  - and `abs(net delta) >= 1`

2. Reconcile / net futures after hedge
- Delta nets futures positions automatically
- app should refresh or normalize tracked futures rows after hedge so app state matches Delta net state

3. Partial hedge logic
- instead of always trying to reset near zero
- hedge only enough to bring drift back into a safer band
- reduces brokerage churn

4. Hysteresis style bands
- separate trigger band and calm band
- avoids repeated hedge flipping around one threshold

5. Separate add-vs-reduce hedge behavior
- future enhancement if needed
- adding futures can require stronger threshold
- reducing hedge can use softer threshold

Suggested future implementation order:

1. minimum absolute delta filter
2. reconcile/net futures after hedge
3. partial hedge logic
  - manual CE/PE buy/sell actions
  - futures buy/sell actions
  - close/kill switch actions

## Recommended Next Step

Next time, do this first:

1. Replace the current minimal `src/views/strategyfo-paper.ejs` with the **full structure** of:
   - `D:\NodeJS\AlgoMarti\views\StrategyFOGreeks.ejs`
   - `D:\NodeJS\AlgoMarti\views\partials\StrategyFOGreeksSettings.ejs`
2. Keep browser state thin.
3. Move every `localStorage` dependency into server profile/runtime APIs.
4. Port features in groups:
   - profile/settings state
   - manual order actions
   - open/closed position management
   - Renko + spread logic
   - payoff graph + analytics

## Notes

- `npm run check` passes
- `npm run build` passes
- current page route is `/strategyfogreeks`
- if `DATABASE_URL` is missing, app falls back to JSON files
