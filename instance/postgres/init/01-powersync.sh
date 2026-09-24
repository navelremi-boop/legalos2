#!/bin/bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-EOSQL
	CREATE USER powersync_replication WITH REPLICATION PASSWORD '${POSTGRES_PASSWORD}';
	GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO powersync_replication;
EOSQL

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-EOSQL
	GRANT USAGE ON SCHEMA public TO powersync_replication;
	GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_replication;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_replication;
	CREATE PUBLICATION powersync FOR ALL TABLES;
EOSQL

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "postgres" <<-EOSQL
	CREATE DATABASE powersync_storage OWNER ${POSTGRES_USER};
EOSQL
