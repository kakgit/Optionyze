# Render Schema Inventory

This note records the current PostgreSQL tables created by Optionyze so migration planning can use exact schema names.

Primary schema source:

- [postgres.ts](D:/NodeJS/Optionyze/src/storage/postgres.ts:76)

## Core Account / Auth Tables

- `optionyze_accounts`
- `optionyze_sessions`
- `optionyze_delta_api_profiles`
- `optionyze_admin_settings`
- `optionyze_strategy_execution_requests`

## Legacy / Older User Tables Still Present

- `optionyze_users`
- `optionyze_runner_states`
- `optionyze_strategyfo_paper_profiles`

These should still be preserved during migration because schema bootstrap and older store code still reference them.

## Rolling Futures LT Tables

- `optionyze_rolling_futures_lt_profiles`
- `optionyze_rolling_futures_lt_positions`
- `optionyze_rolling_futures_lt_runtime`

These are critical for current live futures pages, including Dual.

## Rolling Options LT Tables

- `optionyze_rolling_options_lt_de_profiles`
- `optionyze_rolling_options_lt_de_runtime`
- `optionyze_rolling_options_lt_de_positions`

## Rolling Options PT Tables

- `optionyze_rolling_options_pt_de_profiles`
- `optionyze_rolling_options_pt_de_runtime`
- `optionyze_rolling_options_pt_de_positions`
- `optionyze_rolling_options_pt_de_events`

Important note:

- current live futures activity logging also uses `optionyze_rolling_options_pt_de_events`
- so this event table matters for Dual, Long, and Short futures pages too

## Critical Migration Verification Targets

Minimum important tables to verify after migration:

- `optionyze_accounts`
- `optionyze_delta_api_profiles`
- `optionyze_strategy_execution_requests`
- `optionyze_admin_settings`
- `optionyze_rolling_futures_lt_profiles`
- `optionyze_rolling_futures_lt_positions`
- `optionyze_rolling_futures_lt_runtime`
- `optionyze_rolling_options_pt_de_events`
- `optionyze_sessions`

## Dual-Specific Focus

For Dual migration checks, pay special attention to:

- `optionyze_rolling_futures_lt_profiles`
- `optionyze_rolling_futures_lt_positions`
- `optionyze_rolling_futures_lt_runtime`
- `optionyze_strategy_execution_requests`
- `optionyze_rolling_options_pt_de_events`
