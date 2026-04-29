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

