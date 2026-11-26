# GarmentFlow release plan

Keep [CODEX_PROGRESS.md](CODEX_PROGRESS.md) as the current acceptance record. The release decision requires the remaining acceptance criteria, GitHub CI, a deployment rehearsal, and explicit final approval.

## GitHub candidate

1. Review the working-tree changes by workflow. Keep environment files, QA backups, generated files, and platform metadata out of the candidate. Record the deployment branch's current commit for rollback.
2. Prepare a review branch and pull request after the candidate is ready. Pin the commit and attach QA results, migration review, and known limitations.
3. Require CI against clean PostgreSQL. Check dependency install, Prisma validation, ordered migrations, schema drift, strict lint, TypeScript, optimized build, and authenticated smoke. Verify the same candidate in Vercel Preview using an isolated database and an independent authentication secret.
4. Merge or push to the production deployment branch only after explicit final release approval. Confirm whether that branch triggers production deployment before updating it.

## Neon preflight and migration

1. Independently identify the production project's full pooled and unpooled endpoints, database name, branch and migration history. Verify these differ from QA.
2. Verify production backup or point-in-time recovery availability. Document the recovery point and responsibilities. Rehearse migration and rollback on a disposable branch before release.
3. Verify fresh and upgrade migration paths. The transaction request table and nullable BOM colour reference are additive. Confirm actual production migration history and apply only pending migrations after explicit approval using the verified production migration connection.
4. Check migration status and read-only operational totals before deploying. Record migration time and recovery point.

## Vercel and production verification

1. Verify Preview and Production environment scopes, application origin, Node 24, install and build configuration, and separate authentication secrets. Check that the deploy artifacts exclude QA configuration and backups. Record the last known-good deployment.
2. Deploy the approved commit after the migration gate. Verify deployment commit, health and connectivity, authentication, and read-only smoke across planning, stock, shipments, sales, and finance. Any production write requires explicit authorization.
3. Check error rates, journal balance, account totals, and inventory and shipment counts against pre-release baselines.
4. If smoke or reconciliation fails, pause rollout and restore the previous Vercel deployment. Use Neon recovery only if reconciliation calls for data or schema restoration and approval is obtained.
5. At final QA acceptance, deactivate the dedicated account and revoke outstanding sessions. Temporary role accounts are deactivated as their suites finish.
