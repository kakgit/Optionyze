-- Optionyze manual DB cleanup for removed features
--
-- Purpose:
-- - remove tables that belonged to the deleted Rolling Options features
-- - keep Dual Rolling Futures tables intact
-- - keep shared/legacy tables that are still referenced by current code
--
-- Important:
-- - run this only after you have confirmed the simplified Dual-only app is stable
-- - take a database backup before running
-- - this script is intentionally manual; do not auto-run it during app bootstrap

BEGIN;

-- Removed feature tables:
-- - rolling options live profiles/runtime/positions
-- - rolling options paper profiles/runtime/positions
--
-- Kept on purpose:
-- - optionyze_rolling_options_pt_de_events
--   Dual still uses this shared event table for activity/event logging.
--
-- Also kept on purpose:
-- - optionyze_users
-- - optionyze_runner_states
-- - optionyze_strategyfo_paper_profiles
--   These older tables are still referenced by current store code.

DROP TABLE IF EXISTS optionyze_rolling_options_lt_de_positions;
DROP TABLE IF EXISTS optionyze_rolling_options_lt_de_runtime;
DROP TABLE IF EXISTS optionyze_rolling_options_lt_de_profiles;

DROP TABLE IF EXISTS optionyze_rolling_options_pt_de_positions;
DROP TABLE IF EXISTS optionyze_rolling_options_pt_de_runtime;
DROP TABLE IF EXISTS optionyze_rolling_options_pt_de_profiles;

COMMIT;

-- Recommended follow-up verification:
--
-- select table_name
-- from information_schema.tables
-- where table_schema = 'public'
--   and table_name like 'optionyze_%'
-- order by table_name;
