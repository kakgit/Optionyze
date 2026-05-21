# Render DB Cutover Commands

This note captures the command-level checklist for cutting over Optionyze from Railway Postgres to Render Postgres.

Use this with:

- `RENDER_DB_MIGRATION_RUNBOOK.md`
- `RENDER_ENV_VAR_INVENTORY.md`
- `RENDER_PHASE1_MIGRATION_CHECKLIST.md`

## Important

This file is intentionally written as a practical command template, not as an auto-run script.

Before using any command:

- replace placeholders with real values
- verify source and target carefully
- perform the migration in a controlled window

## Placeholders

Use these placeholders consistently:

- `<RAILWAY_HOST>`
- `<RAILWAY_PORT>`
- `<RAILWAY_DB>`
- `<RAILWAY_USER>`
- `<RAILWAY_PASSWORD>`

- `<RENDER_HOST>`
- `<RENDER_PORT>`
- `<RENDER_DB>`
- `<RENDER_USER>`
- `<RENDER_PASSWORD>`

- `<DUMP_FILE>`

Example dump filename:

- `optionyze_railway_dump_YYYYMMDD.sql`

## Option 1: SQL Dump Using `pg_dump`

### Export Railway Postgres

```powershell
$env:PGPASSWORD="<RAILWAY_PASSWORD>"
pg_dump `
  -h <RAILWAY_HOST> `
  -p <RAILWAY_PORT> `
  -U <RAILWAY_USER> `
  -d <RAILWAY_DB> `
  -f <DUMP_FILE>
```

If SSL is required for Railway source, add the appropriate SSL settings in the environment or connection string.

### Import Into Render Postgres

```powershell
$env:PGPASSWORD="<RENDER_PASSWORD>"
psql `
  -h <RENDER_HOST> `
  -p <RENDER_PORT> `
  -U <RENDER_USER> `
  -d <RENDER_DB> `
  -f <DUMP_FILE>
```

## Option 2: Custom Format Dump Using `pg_dump -Fc`

Useful if you want more restore control.

### Export Railway Postgres

```powershell
$env:PGPASSWORD="<RAILWAY_PASSWORD>"
pg_dump `
  -h <RAILWAY_HOST> `
  -p <RAILWAY_PORT> `
  -U <RAILWAY_USER> `
  -d <RAILWAY_DB> `
  -Fc `
  -f <DUMP_FILE>
```

### Restore Into Render Postgres

```powershell
$env:PGPASSWORD="<RENDER_PASSWORD>"
pg_restore `
  -h <RENDER_HOST> `
  -p <RENDER_PORT> `
  -U <RENDER_USER> `
  -d <RENDER_DB> `
  --clean `
  --if-exists `
  <DUMP_FILE>
```

Use `--clean` carefully. Only use it when you are certain the target DB should be overwritten by the restored contents.

## Post-Migration Verification Commands

### Count Accounts

```powershell
$env:PGPASSWORD="<RENDER_PASSWORD>"
psql `
  -h <RENDER_HOST> `
  -p <RENDER_PORT> `
  -U <RENDER_USER> `
  -d <RENDER_DB> `
  -c "select count(*) from optionyze_accounts;"
```

### Count Delta API Profiles

```powershell
$env:PGPASSWORD="<RENDER_PASSWORD>"
psql `
  -h <RENDER_HOST> `
  -p <RENDER_PORT> `
  -U <RENDER_USER> `
  -d <RENDER_DB> `
  -c "select count(*) from optionyze_delta_api_profiles;"
```

### Count Dual Runtime Rows

```powershell
$env:PGPASSWORD="<RENDER_PASSWORD>"
psql `
  -h <RENDER_HOST> `
  -p <RENDER_PORT> `
  -U <RENDER_USER> `
  -d <RENDER_DB> `
  -c "select count(*) from optionyze_rolling_futures_lt_runtime where strategy_code = 'dual';"
```

### Count Pending Strategy Execution Rows

```powershell
$env:PGPASSWORD="<RENDER_PASSWORD>"
psql `
  -h <RENDER_HOST> `
  -p <RENDER_PORT> `
  -U <RENDER_USER> `
  -d <RENDER_DB> `
  -c "select count(*) from optionyze_strategy_exec_requests;"
```

### Count Activity/Event Rows

```powershell
$env:PGPASSWORD="<RENDER_PASSWORD>"
psql `
  -h <RENDER_HOST> `
  -p <RENDER_PORT> `
  -U <RENDER_USER> `
  -d <RENDER_DB> `
  -c "select count(*) from optionyze_rolling_options_pt_de_events;"
```

## Spot-Check Commands

### Verify Bootstrap Admin Row

```powershell
$env:PGPASSWORD="<RENDER_PASSWORD>"
psql `
  -h <RENDER_HOST> `
  -p <RENDER_PORT> `
  -U <RENDER_USER> `
  -d <RENDER_DB> `
  -c "select full_name, email from optionyze_accounts order by id limit 5;"
```

### Verify Recent Event Rows

```powershell
$env:PGPASSWORD="<RENDER_PASSWORD>"
psql `
  -h <RENDER_HOST> `
  -p <RENDER_PORT> `
  -U <RENDER_USER> `
  -d <RENDER_DB> `
  -c "select title, created_at from optionyze_rolling_options_pt_de_events order by created_at desc limit 10;"
```

## Final Cutover Checklist

After DB import succeeds:

1. update Render app `DATABASE_URL`
2. set `PGSSLMODE` for Render correctly
3. boot Render app
4. confirm:
   - login works
   - `mngUsers` works
   - Dual page works
   - Delta API profiles load
   - pending strategy requests load
5. stop using Railway as primary DB target

## Rollback Note

If cutover fails:

- restore production app DB settings back to Railway
- redeploy app to the known-good Railway DB target
- investigate before trying again

Do not delete Railway Postgres immediately after first cutover.

## Recommended Next Step

Before the real migration window, prepare a local copy of:

- source DB connection details
- target DB connection details
- exact verified table names
- exact dump file path

Then do one rehearsal on non-critical data if possible.
