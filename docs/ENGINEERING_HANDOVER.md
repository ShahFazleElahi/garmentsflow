# GarmentFlow engineering handover

[CODEX_PROGRESS.md](CODEX_PROGRESS.md) records current acceptance counts, open tasks and release gates. The [release plan](RELEASE_CHECKLIST.md) covers GitHub, Neon, Vercel, and rollback.

## QA isolation and historical baseline

- The QA application runs on loopback port 3100. The launcher and test harness verify that the repository-owned Next.js process holds the port and uses the same three QA connection strings as the QA configuration. They normalize pooled hosts to the full expected Neon hostname and check database neondb and QA_MODE.
- The dedicated QA automation owner already existed. Its name, role and bcrypt credential matched. The credential file is mode 600 and ignored by Git and Vercel. Authenticated smoke verified the session cookie, protected API access and revocation. Final cleanup verified 15 inactive temporary QA accounts and zero open QA sessions. The dedicated account stays enabled until final QA acceptance.
- Historical plan PRD-202611-0001 was read back without writes. Its 16 variants, batch allocations and final QC each reconcile to 200 pieces. There were zero open or in-progress rework orders and zero unresolved rework inspections. The historical audit records QC validation and the status change. The audit reason lacks the original unresolved-rework query details.
- Historical landed cost was checked read-only. BDT 24,000 ties to the shipment allocations, inventory and logistics payable. The original receipt link, two sales invoices, BDT 310,000 revenue, BDT 74,537.50 COGS, and 100 remaining pieces also matched the historical baseline. Historical mutation batches were inspected and left untouched. New runtime tests use unique QA fixtures and keep their business and journal records for tracing.

## Workflow changes and coverage

- Older BOM lines continue to apply to every colour. New lines can target a colour and use size overrides. Concurrent MRP regeneration preserves requirement identities for surviving materials.
- Production protects completion and cancellation. Reservations protect available stock and are consumed or released transactionally. Vendor collection validates quantity evidence and posts material, service, transport and waste journals. Rework closes through audited reinspection and contributes to final QC once.
- Sales, receipts and payments use transaction locks and persisted request claims in tested workflows. Cash withdrawals use locked Decimal balances. Financial statements aggregate journal lines in the database. Freight payments clear the shipment accrual and use cumulative FX rounding.
- Authorization adds module mutation permissions, assigned warehouses on covered endpoints, and financial field filtering. Non-owner documents are available to the uploader. The representative warehouse, QC and data-entry role tests are part of the wider acceptance suite.
- New BDT purchasing supports partial receipt allocation of discounts, input tax, and a posted supplier advance. Earlier receipts with unreconciled charges, foreign-currency purchasing, and tax-bearing returns require their corresponding reconciliation workflows.
- Live APIs and Chromium covered selected transaction and barcode workflows. The progress report records the broader scenario and production gates that remain.

## Verification record

| Area | Runtime evidence |
|---|---|
| Session security | Authenticated smoke, correct TOTP challenge, blocked TOTP replay, one-time recovery, and revocation of every prior session after password change. |
| Production | Plan and batch completion guards, work-order completion and cancellation guards, QC quantity limits, unresolved rework, concurrent reinspection, and location-specific finished goods capitalization. |
| Manufacturing and stock | Colour-scoped MRP and stable concurrent regeneration, capacity and reservation controls, vendor custody reconciliation, embroidery and tailoring inspection, physical counts, transfers, and write-offs. |
| Purchasing and freight | Replay-safe receipt and vendor payment, return credit, BDT discount and input tax allocation, supplier advance application, local and international dispatch and receiving, and freight payable settlement. |
| Sales and accounting | API replays and conflicting payloads, Chromium duplicate click, negative cash and competing withdrawals, control account and reversal denials, expense validation, discount and profitability precision, trial balance, and balance sheet. |
| Security and packaging | Representative module and warehouse roles, financial field restrictions, document ownership and file validation, barcode and QR lookup, and printed label rendering in Chromium. |

All 13 targeted runtime groups passed against the rebuilt loopback server. Prisma validation, generation, typecheck, strict lint, the optimized QA build, migration status and schema comparison passed. QA has all three migrations and Prisma found no difference. Both dependency scans reported zero advisories. The repository configured-value audit scanned 124 source files and reported zero matches.

The statement query benchmark used eight paired QA samples. The previous read returned 176 line rows and had a median of 245 ms. The grouped read returned 27 account rows and had a median of 80 ms. Decimal totals matched in every pair. End-to-end samples and per-module acceptance are recorded in the local QA evidence and progress tracker.

Remaining release acceptance includes the full role and route matrix, held shipment discrepancy reconciliation, foreign-currency purchasing and tax-bearing return workflows, clean deployed CI and Preview, and a recovery rehearsal. Explicit approval gates all production activity.
