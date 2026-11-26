# GarmentFlow — repair and deployment audit

## Changes made

- Converted Prisma's SQLite datasource to PostgreSQL and prepared the initial migration, including existing models and additional authentication rate-limit storage, encrypted 2FA replay state and document bytes. Retained the application schema and original Bun lock rather than introducing a framework upgrade.
- Added Node 22 configuration, Vercel build configuration, environment template, git exclusions, explicit database initialization, and GitHub Actions PostgreSQL checks. Removed TypeScript build-error suppression and network-dependent font loading.
- Disabled public owner bootstrap and hardcoded demo login; hardened session storage, cookie settings, password validation, login throttling, 2FA replay/recovery handling, cross-origin checks and role administration.
- Corrected product planning matrix totals, variant uniqueness, plan status validation, MRP response handling, work-order detail routing, atomic sequence generation and guarded stock updates.
- Corrected accounting reversal handling, currency calculations, vendor and sales payment handling and selected dashboard totals. Prevented unsafe sales cancellation rather than leaving unreversed financial and stock records.
- Improved API error responses, health status reporting, CSV formula escaping, decimal serialization and persisted document upload/download handling for Vercel's ephemeral filesystem.
- Removed the old SQLite data, sandbox artifacts and demo transaction seed. Initial owner and necessary master data can be created using the new initializer.

## Checks performed in the repair environment

- Static TypeScript parser: 96 TS/TSX files, zero syntax diagnostics. This is not a dependency-aware typecheck.
- Node syntax checks: database initializer and smoke test scripts passed.
- PostgreSQL migration: static comparison of all 69 model names and scalar columns against SQL table definitions passed. SQL execution and Prisma schema-drift checks remain pending.
- Production build attempted: blocked because Prisma/dependencies are not installed. npm registry DNS resolution was unavailable in this environment, preventing installation. No successful full TypeScript check, production build, database migration or live authentication test is claimed.

## Required release verification

Run the included GitHub Actions workflow and resolve any errors it finds. Execute end-to-end acceptance tests with a staging database, including color/size planning, purchasing, vendor issue/receipt, stock transfers, quality/rework, packing, sales, foreign currency payments, accounting reconciliation and role permissions. Check dependency advisories with network access. The smoke test does not cover all business logic or concurrency cases. Review transaction idempotency and access control for every mutation before multi-user production use.

Location assignments are informational, not a complete location-level authorization policy. Sales cancellation is intentionally disabled pending complete reversal handling. Existing SQLite data has not been migrated. A clean PostgreSQL database is assumed. No live GitHub, Vercel or Neon deployment has been performed, and a zero-bug guarantee is not possible from static review alone.
