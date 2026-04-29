# Optionyze

Optionyze is a backend-first trading platform intended to run multi-user strategies on the server.

## Initial scope

- Covered Call: live trading runner
- StrategyFOGreeks: paper trading runner
- User management: server-side user and strategy profile control
- Storage: PostgreSQL-first with JSON fallback during migration

## Project shape

- `src/app`: server bootstrap
- `src/api`: admin and control APIs
- `src/runners`: runner manager and per-strategy runners
- `src/strategies`: pure strategy modules
- `src/brokers`: exchange adapters
- `src/storage`: PostgreSQL and JSON storage adapters
- `data/`: persisted users, profiles, state, trades, runtime, and logs

## Next steps

1. Install dependencies with `npm install`
2. Set `DATABASE_URL` to enable PostgreSQL storage
3. Port CoveredCall live logic into pure server modules
4. Port StrategyFOGreeks paper engine into isolated per-user runners
5. Add admin APIs for user, profile, and runner control

## Storage mode

- If `DATABASE_URL` is present, Optionyze uses PostgreSQL tables for users and runner state.
- If `DATABASE_URL` is missing, Optionyze falls back to JSON files in `data/` so the app can still bootstrap locally.

## GitHub and Railway deployment

1. Create a new empty GitHub repository.
2. Initialize Git locally and push this project:
   - `git init`
   - `git add .`
   - `git commit -m "Initial commit"`
   - `git branch -M main`
   - `git remote add origin <your-github-repo-url>`
   - `git push -u origin main`
3. In Railway, create a new project and choose `Deploy from GitHub repo`.
4. Select this repository and set the required environment variables:
   - `DATABASE_URL`
   - `PGSSLMODE` as needed by your Postgres provider
   - `NODE_ENV=production`
   - `BOOTSTRAP_ADMIN_NAME`
   - `BOOTSTRAP_ADMIN_EMAIL`
   - `BOOTSTRAP_ADMIN_PASSWORD`
   - `BOOTSTRAP_ADMIN_MOBILE`
   - `TELEGRAM_BOT_TOKEN` if Telegram features are enabled
5. Railway will run `npm run build` and `npm start` using `railway.json`.
