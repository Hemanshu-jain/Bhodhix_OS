# PostgreSQL migration status

The schema is the target for hosted storage. The app still uses its existing file stores; setting `DATABASE_URL` alone does not switch runtime storage.

## Offline preparation

From `server/`, run `npm run db:prepare-legacy` to count the installed app's records without printing user content. Run `npm run db:archive-legacy -- --dry-run` to inspect source file counts and checksums, then `npm run db:import-legacy -- --dry-run` to preview the normalized import. The installed profile is used when it exists; otherwise the project vault is selected. The older tenant copy and recovery snapshots are archived as separate sources.

## When PostgreSQL is provisioned

Set `DATABASE_URL` in the host's secret settings, then run `npm run db:import-legacy -- --dry-run` and review the counts before running `npm run db:import-legacy`. The importer applies the schema, archives original files with SHA-256 checksums, and imports supported records in a transaction without deleting or rewriting source files. Keep the offline backups until runtime cutover is verified.

Encryption keys are not copied into PostgreSQL. Configure the existing connector/field-work key and Web Push private key as host secrets so existing encrypted integration records and photo data remain decryptable after import.

This branch includes the schema and a normalized legacy importer, but not the runtime PostgreSQL adapters or deployment cutover. Do not serve hosted traffic from this branch until those are implemented and verified.
