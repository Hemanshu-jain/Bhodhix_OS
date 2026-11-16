# PostgreSQL migration status

The schema is the target for hosted storage. The app still uses its existing file stores; setting `DATABASE_URL` alone does not switch runtime storage.

## Offline preparation

From `server/`, run `npm run db:prepare-legacy` to count the installed app's records without printing user content. Run `npm run db:archive-legacy -- --dry-run` to inspect source file counts and checksums. The installed profile is used when it exists; otherwise the project vault is selected. The older tenant copy and recovery snapshots are archived as separate sources.

## When PostgreSQL is provisioned

Set `DATABASE_URL` in the host's secret settings, then run `npm run db:migrate` and `npm run db:archive-legacy`. The archive command applies the schema first, stores original files with SHA-256 checksums, and never deletes or rewrites the source files. Keep the offline backups until normalized import and runtime cutover are verified.

Encryption keys are not copied into PostgreSQL. Configure the existing connector/field-work key and Web Push private key as host secrets so existing encrypted integration records and photo data remain decryptable after import.

This branch does not yet include the runtime PostgreSQL adapters, normalized legacy importer, or deployment cutover.
