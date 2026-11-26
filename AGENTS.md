# GarmentFlow Engineering Instructions

- Work only inside this repository.
- Preserve existing uncommitted changes and add targeted patches only.
- Never use destructive Git or database commands.
- Keep `.env*`, `.neon`, `.vercel`, credentials and `.patch-backups/` out of tracked changes.
- Run QA operations only with `.env.qa.local` loaded and verified against the QA Neon endpoint.
- Never modify production business data during QA.
- Use Decimal arithmetic for financial calculations and keep every journal balanced and transactional.
- Operational control accounts require dedicated workflows; do not bypass inventory, accounting or audit constraints.
- Cancellation and manual completion are unsupported unless explicitly implemented with stock and journal reconciliation.
- Validate changes with the smallest relevant test first, then static and build checks.
- Report actual evidence: implemented, static-verified, runtime-tested, release-ready, or blocked.
