#!/bin/sh
# Runs once, on an empty data volume. The owner role (POSTGRES_USER) runs
# migrations; the runtime role gets data access only, never DDL or role rights.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password POSTGRES_APP_PASSWORD
CREATE ROLE sworg_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE sworg TO sworg_app;
GRANT USAGE ON SCHEMA public TO sworg_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sworg IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sworg_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sworg IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sworg_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sworg IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO sworg_app;
SQL
