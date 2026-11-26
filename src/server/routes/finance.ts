import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { bad, ok, ser, requirePerm, q, qDate } from "./helpers";
import { NextRequest } from "next/server";
import { D, nextDocNo, logAudit, logActivity, postJournal, ACC, reverseJournal, claimTransactionRequest } from "../core";
import { postFinishedMovement } from "../inventory";
import { scopedLocations } from "../auth";


// ───────────────────────── GET ─────────────────────────
export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, "view_financial");
  if ("error" in auth) return auth.error;
  const locations = scopedLocations(auth.user);
  if (locations && resource !== "sales") return bad("Company-wide financial resources require unrestricted access", 403);

  if (resource === "journal") {
    const take = 200;
    const rows = await db.journalEntry.findMany({
      include: { lines: { include: { account: true } } },
      orderBy: { date: "desc" }, take,
    });
    return ok(ser(rows));
  }
  if (resource === "expenses") {
    const rows = await db.expense.findMany({ orderBy: { date: "desc" }, include: { partner: true } });
    return ok(ser(rows));
  }
  if (resource === "invoices") {
    const rows = await db.vendorInvoice.findMany({ include: { partner: true }, orderBy: { date: "desc" } });
    return ok(ser(rows));
  }
  if (resource === "payments") {
    const rows = await db.payment.findMany({ orderBy: { date: "desc" }, take: 300 });
    return ok(ser(rows));
  }
  if (resource === "sales" && !id) {
    const rows = await db.salesInvoice.findMany({
      where: locations ? { locationId: { in: locations } } : undefined,
      include: { customer: true, items: { include: { variant: true } } },
      orderBy: { invoiceDate: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "statements") {
    const type = q(req, "type") ?? "trial";
    if (!["trial", "pl", "bs", "cashflow"].includes(type)) return bad("Unknown statement type");
    const from = qDate(req, "from") ?? new Date(2000, 0, 1);
    const to = qDate(req, "to") ?? new Date();
    const date = type === "bs" || type === "trial" ? { lte: to } : { gte: from, lte: to };
    const cashTypes = ["CASH", "BANK", "MOBILE_BANKING"];
    const totals = await db.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: {
        date,
        ...(type === "cashflow" ? { lines: { some: { account: { type: { notIn: cashTypes } } } } } : {}),
      } },
      _sum: { debit: true, credit: true },
    });
    const byAccount = new Map(totals.map(row => [row.accountId, row._sum]));
    const accounts = await db.account.findMany({ orderBy: { code: "asc" } });
    const rows = accounts.map(account => {
      const sums = byAccount.get(account.id);
      const debit = D(sums?.debit);
      const credit = D(sums?.credit);
      return { code: account.code, name: account.name, type: account.type, debit, credit, net: debit.sub(credit) };
    }).filter(row => !row.debit.isZero() || !row.credit.isZero());
    const sum = (amounts: Prisma.Decimal[]) => amounts.reduce((value, amount) => value.add(amount), D(0));

    if (type === "trial") {
      const trial = rows.filter(row => !row.net.isZero()).map(({ code, name, type, net }) => ({
        code, name, type, debit: net.gt(0) ? net : D(0), credit: net.lt(0) ? net.neg() : D(0),
      }));
      return ok(ser({ type, rows: trial, totalDebit: sum(trial.map(row => row.debit)), totalCredit: sum(trial.map(row => row.credit)) }));
    }

    const amounts = (filter: (row: typeof rows[number]) => boolean, creditNormal = false) =>
      rows.filter(row => !row.net.isZero() && filter(row))
        .map(({ code, name, net }) => ({ code, name, amount: creditNormal ? net.neg() : net }));
    const income = amounts(row => row.type === "INCOME", true);
    const expense = amounts(row => row.type === "EXPENSE");
    const totalIncome = sum(income.map(row => row.amount));
    const totalExpense = sum(expense.map(row => row.amount));
    const netProfit = totalIncome.sub(totalExpense);
    if (type === "pl") return ok(ser({ type, income, expense, totalIncome, totalExpense, netProfit }));

    if (type === "bs") {
      const isLiability = (row: typeof rows[number]) => row.type === "PAYABLE" ||
        (row.type === "TAX" && (row.code === ACC.OUTPUT_TAX || (row.code !== ACC.INPUT_TAX && row.net.lt(0))));
      const assets = amounts(row => ["CASH", "BANK", "MOBILE_BANKING", "RECEIVABLE", "INVENTORY", "ADVANCE", "TAX"].includes(row.type) && !isLiability(row));
      const liabilities = amounts(isLiability, true);
      const equity = amounts(row => row.type === "EQUITY", true);
      if (!netProfit.isZero()) equity.push({ code: "3900", name: "Retained Earnings (Current)", amount: netProfit });
      return ok(ser({
        type, assets, liabilities, equity,
        totalAssets: sum(assets.map(row => row.amount)),
        totalLiabilities: sum(liabilities.map(row => row.amount)),
        totalEquity: sum(equity.map(row => row.amount)),
      }));
    }

    const cashflow = Object.entries({ CASH: "Cash", BANK: "Bank", MOBILE_BANKING: "Mobile Banking" }).flatMap(([accountType, name]) => {
      const matching = rows.filter(row => row.type === accountType);
      if (!matching.length) return [];
      const inflow = sum(matching.map(row => row.debit));
      const outflow = sum(matching.map(row => row.credit));
      return [{ name, inflow, outflow, net: inflow.sub(outflow) }];
    });
    const totalIn = sum(cashflow.map(row => row.inflow));
    const totalOut = sum(cashflow.map(row => row.outflow));
    return ok(ser({ type, rows: cashflow, totalIn, totalOut, net: totalIn.sub(totalOut) }));
  }
  if (resource === "cashbook") {
    const accounts = await db.account.findMany({ where: { type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } } });
    const rows = await db.journalEntry.findMany({
      where: { lines: { some: { account: { type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } } } } },
      include: { lines: { include: { account: true } } },
      orderBy: { date: "desc" }, take: 300,
    });
    return ok(ser({ accounts, rows }));
  }
  if (resource === "costing") {
    const planId = q(req, "planId");
    if (planId) {
      const variants = await db.productVariant.findMany({ where: { planId }, include: { cost: true, plan: true } });
      const entries = await db.costEntry.findMany({ where: { variant: { planId } }, orderBy: { date: "asc" }, include: { variant: true } });
      const plan = await db.productPlan.findUnique({ where: { id: planId } });
      const landed = await db.landedCostEntry.findMany({ where: { variant: { planId } }, include: { shipment: true, variant: true } });
      const sales = await db.salesInvoiceItem.findMany({ where: { variant: { planId } }, include: { invoice: true } });
      return ok(ser({ plan, variants, entries, landed, sales }));
    }
    const rows = await db.variantCost.findMany({ include: { variant: { include: { plan: true } } }, take: 300 });
    return ok(ser(rows));
  }
  return bad(`Unknown finance resource: ${resource}`, 404);
}

// ───────────────────────── POST ─────────────────────────
export async function handlePost(segments: string[], body: Record<string, unknown>, req: NextRequest) {
  const [resource, action] = segments;
  const auth = await requirePerm(req, action === "reverse" ? "reverse" : action === "cancel" ? "cancel" : "post");
  if ("error" in auth) return auth.error;
  const { user } = auth;
  if (!user.permissions.includes("*") && !user.permissions.includes("view_financial")) return bad("Permission denied: view_financial", 403);
  const locations = scopedLocations(user);
  if (locations) {
    if (resource !== "sales") return bad("Company-wide financial posting requires unrestricted access", 403);
    const allowed = action === "create"
      ? await db.warehouse.count({ where: { id: String(body.warehouseId ?? ""), locationId: { in: locations } } })
      : await db.salesInvoice.count({ where: { id: String(body.invoiceId ?? body.id ?? ""), locationId: { in: locations } } });
    if (!allowed) return bad("Sales location access denied", 403);
  }

  if (resource === "logistics-payments" && action === "pay") {
    try {
      const payment = await db.$transaction(async tx => {
        const request = await claimTransactionRequest(tx, "LOGISTICS_PAYMENT", body, user.id);
        if (!request) throw new Error("A payment idempotency key is required");
        if (request.resourceId) return tx.payment.findUniqueOrThrow({ where: { id: request.resourceId } });

        const id = String(body.shipmentId ?? "");
        await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${id} FOR UPDATE`;
        const shipment = await tx.shipment.findUnique({ where: { id } });
        if (!shipment || shipment.type !== "INTERNATIONAL" || shipment.status !== "RECEIVED_VERIFIED") {
          throw new Error("Only verified international shipments can be settled");
        }
        const partnerId = shipment.freightForwarderId;
        const partner = partnerId ? await tx.businessPartner.findUnique({ where: { id: partnerId } }) : null;
        if (!partner || partner.type !== "FREIGHT_FORWARDER") throw new Error("A freight forwarder is required for settlement");
        const accrued = await tx.journalLine.aggregate({
          where: { account: { code: ACC.AP_LOGISTICS }, entry: { refType: "SHIPMENT", refId: id, reversedAt: null, reversalOfId: null } },
          _sum: { credit: true, debit: true },
        });
        const accrual = D(accrued._sum.credit).sub(D(accrued._sum.debit));
        if (accrual.lte(0) || !accrual.eq(shipment.totalCostBdt) ||
            !D(shipment.totalCost).mul(shipment.exchangeRate).toDecimalPlaces(2).eq(accrual)) {
          throw new Error("Shipment accrual requires accounting reconciliation before settlement");
        }

        const amount = D(typeof body.amount === "number" ? body.amount : 0);
        const paid = D(shipment.paidAmount).add(amount);
        if (!amount.isFinite() || amount.lte(0) || !amount.eq(amount.toDecimalPlaces(2)) || paid.gt(shipment.totalCost)) {
          throw new Error("Payment must be positive and within the outstanding shipment amount");
        }
        const amountBdt = paid.mul(shipment.exchangeRate).toDecimalPlaces(2)
          .sub(D(shipment.paidAmount).mul(shipment.exchangeRate).toDecimalPlaces(2));
        if (amountBdt.lte(0)) throw new Error("Converted payment must be positive");
        const account = await tx.account.findFirst({
          where: { id: String(body.accountId ?? ""), isActive: true, currency: "BDT", type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } },
        });
        if (!account) throw new Error("An active BDT payment account is required");
        const code = await nextDocNo(tx, "PAY");
        const posted = await tx.payment.create({
          data: { code, direction: "OUT", partnerId: partner.id, accountId: account.id, amount: amountBdt,
            method: "BANK", reference: shipment.code, createdById: user.id },
        });
        await postJournal(tx, {
          memo: `Logistics payment ${code} for ${shipment.code}`, refType: "LOGISTICS_PAYMENT",
          refId: posted.id, refNo: shipment.code, userId: user.id,
          lines: [{ accountCode: ACC.AP_LOGISTICS, debit: amountBdt }, { accountCode: account.code, credit: amountBdt }],
        });
        await tx.shipment.update({ where: { id }, data: { paidAmount: paid } });
        await tx.salesRequest.update({ where: { key: request.key }, data: { resourceId: posted.id } });
        await logAudit(tx, { userId: user.id, userName: user.name, action: "POST", entity: "Shipment", entityId: id,
          refNo: shipment.code, prevJson: { paidAmount: shipment.paidAmount }, newJson: { paidAmount: paid, paymentId: posted.id } });
        return posted;
      });
      return ok(ser(payment));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (resource === "expenses" && action === "create") {
    try {
      const result = await db.$transaction(async (tx) => {
        const idem = body.idempotencyKey as string | undefined;
        if (idem) {
          const dupe = await tx.expense.findFirst({ where: { notes: { startsWith: `idem:${idem}` } } });
          if (dupe) return { duplicate: true, expense: dupe };
        }
        const code = await nextDocNo(tx, "EXP");
        const amount = Number(body.amount ?? 0);

        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("Amount must be finite and positive");
        }

        if (body.shipmentId) {
          throw new Error(
            "Shipment-linked expenses require the dedicated logistics accounting workflow"
          );
        }
        const category = String(body.category ?? "Miscellaneous");
        const accountCode = String(body.accountCode ?? "1010");

        if (body.paymentStatus !== "UNPAID") {
          const paymentAccount = await tx.account.findUnique({
            where: { code: accountCode },
          });

          if (!paymentAccount?.isActive ||
              !["CASH", "BANK", "MOBILE_BANKING"].includes(
                paymentAccount.type
              )) {
            throw new Error(
              "An active cash, bank or mobile banking account is required"
            );
          }

          if (body.accountId &&
              body.accountId !== paymentAccount.id) {
            throw new Error(
              "Expense payment account mismatch"
            );
          }

          if (paymentAccount.currency !== "BDT") {
            throw new Error(
              "Foreign currency expenses require a dedicated FX workflow"
            );
          }
        }

        if (String(body.currency ?? "BDT") !== "BDT") {
          throw new Error(
            "Foreign currency expenses require a dedicated FX workflow"
          );
        }
        const expense = await tx.expense.create({
          data: {
            code, date: body.date ? new Date(String(body.date)) : new Date(),
            category, description: String(body.description ?? ""),
            partnerId: (body.partnerId as string) || null, planId: (body.planId as string) || null,
            batchId: (body.batchId as string) || null, locationId: (body.locationId as string) || null,
            shipmentId: (body.shipmentId as string) || null,
            amount: D(amount), currency: String(body.currency ?? "BDT"),
            accountId: (body.accountId as string) || null,
            paymentStatus: String(body.paymentStatus ?? "PAID"),
            approvedById: amount > 50000 ? user.id : null,
            isDemo: Boolean(body.isDemo), notes: `idem:${idem ?? ""}`,
            createdById: user.id,
          },
        });
        // journal: expense debit, cash credit (unless unpaid → payable)
        const accountMap: Record<string, string> = {
          "Transportation": ACC.FREIGHT, "Courier": ACC.FREIGHT, "International Freight": ACC.FREIGHT,
          "Customs": ACC.CUSTOMS, "Packaging": ACC.PACKAGING,
        };
        const expenseCode = accountMap[category] ?? ACC.OPEX;
        if (body.paymentStatus !== "UNPAID") {
          await postJournal(tx, {
            memo: `Expense ${code}: ${body.description ?? category}`, refType: "EXPENSE", refId: expense.id, refNo: code, userId: user.id,
            lines: [
              { accountCode: expenseCode, debit: amount },
              { accountCode: accountCode, credit: amount },
            ],
          });
        } else {
          await postJournal(tx, {
            memo: `Expense ${code} (on account)`, refType: "EXPENSE", refId: expense.id, refNo: code, userId: user.id,
            lines: [
              { accountCode: expenseCode, debit: amount },
              { accountCode: ACC.AP_SUPPLIER, credit: amount },
            ],
          });
        }
        // batch-linked expense → variant costing
        if (body.batchId) {
          const bvs = await tx.batchVariant.findMany({ where: { batchId: String(body.batchId) } });
          const totalQty = bvs.reduce((a, v) => a + v.plannedQty, 0) || 1;
          const { addCostEntries } = await import("../costing");
          await addCostEntries(tx, bvs.map((v) => ({
            variantId: v.variantId, batchId: v.batchId, category: category.toUpperCase().replace(/[^A-Z]/g, "_"),
            amount: (amount * v.plannedQty) / totalQty, refType: "EXPENSE", refId: expense.id, refNo: code,
          })));
        }
        await logActivity(tx, { module: "FINANCE", action: "expense_recorded", description: `Expense ${code}: ${category} — ৳${amount.toLocaleString()} (${body.description ?? ""})`, userName: user.name, planId: (body.planId as string) || undefined, refNo: code, amount });
        return { expense, duplicate: false };
      });
      return ok(ser(result));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (resource === "journal" && action === "create") {
    try {
      const result = await db.$transaction(async (tx) => {
        const lines = (body.lines ?? []) as { accountCode: string; debit: number; credit: number; memo?: string }[];
        if (!Array.isArray(lines) || lines.length < 2) {
          throw new Error("At least two journal lines are required");
        }

        const protectedAccounts = new Set([
          ACC.RM_INV,
          ACC.FG_INV,
          ACC.WIP,
          ACC.AR,
          ACC.AP_SUPPLIER,
          ACC.AP_LOGISTICS,
          ACC.SALES,
          ACC.COGS,
          ACC.LANDED,
          "2010",
          "2020",
        ]);

        if (lines.some(line =>
          !line ||
          typeof line.accountCode !== "string" ||
          protectedAccounts.has(line.accountCode)
        )) {
          throw new Error(
            "Operational control accounts require a dedicated accounting workflow"
          );
        }

        if (!lines.some(line => D(line.debit).gt(0)) ||
            !lines.some(line => D(line.credit).gt(0))) {
          throw new Error("Journal requires positive debit and credit amounts");
        }

        const entryId = await postJournal(tx, {
          memo: String(body.memo ?? "Manual journal entry"), refType: "MANUAL", userId: user.id, lines,
        });
        await logAudit(tx, { userId: user.id, userName: user.name, action: "POST", entity: "JournalEntry", entityId: entryId, newJson: body });
        return { entryId };
      });
      return ok(result);
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if (resource === "journal" && action === "reverse") {
    try {
      const result = await db.$transaction(async (tx) => {
        const original = await tx.journalEntry.findUnique({
          where: { id: String(body.id) },
        });

        if (!original) {
          throw new Error("Journal entry not found");
        }

        if (original.refType !== "MANUAL") {
          throw new Error(
            "Operational journals require reversal through their originating workflow"
          );
        }

        const protectedCodes = new Set([
          ACC.RM_INV,
          ACC.FG_INV,
          ACC.WIP,
          ACC.AR,
          ACC.AP_SUPPLIER,
          ACC.AP_LOGISTICS,
          ACC.SALES,
          ACC.COGS,
          ACC.LANDED,
          "2010",
          "2020",
        ]);

        const originalLines = await tx.journalLine.findMany({
          where: { entryId: original.id },
          include: { account: true },
        });

        if (originalLines.some(
          line => protectedCodes.has(line.account.code)
        )) {
          throw new Error(
            "Control account reversal requires dedicated reconciliation"
          );
        }

        const reason = String(body.reason ?? "").trim();

        if (reason.length < 5) {
          throw new Error("A valid journal reversal reason is required");
        }

        await reverseJournal(
          tx,
          original.id,
          user.id,
          reason
        );
        await logAudit(tx, { userId: user.id, userName: user.name, action: "REVERSE", entity: "JournalEntry", entityId: String(body.id), reason: String(body.reason ?? "") });
        return { reversed: true };
      });
      return ok(result);
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  // ── Sales ──
  if (resource === "sales") {
    switch (action) {
      case "create": {
        try {
          const result = await db.$transaction(async (tx) => {
            const request = await claimTransactionRequest(
              tx, "SALE_CREATE", body, user.id
            );

            if (request?.resourceId) {
              const existing = await tx.salesInvoice.findUniqueOrThrow({
                where: { id: request.resourceId },
              });

              return {
                invoice: existing,
                duplicate: true,
              };
            }

            const code = await nextDocNo(tx, "SI");
            const customerId = String(body.customerId);
            const customer = await tx.businessPartner.findUnique({ where: { id: customerId } });
            if (!customer || !customer.isActive) {
              throw new Error("Customer not found or inactive");
            }
            const items = (body.items ?? []) as { variantId: string; qty: number; unitPrice: number }[];
            if (!Array.isArray(items) ||
                !items.length ||
                items.some(i =>
                  !i ||
                  typeof i.variantId !== "string" ||
                  !i.variantId ||
                  !Number.isSafeInteger(i.qty) ||
                  i.qty <= 0 ||
                  !Number.isFinite(i.unitPrice) ||
                  i.unitPrice <= 0
                )) {
              throw new Error("Invalid sale items");
            }

            if (new Set(items.map(i => i.variantId)).size !== items.length) {
              throw new Error("Duplicate sale variants");
            }

            items.sort((a, b) => a.variantId.localeCompare(b.variantId));

            const saleType = String(body.type ?? "WHOLESALE");

            if (!["WHOLESALE", "RETAIL"].includes(saleType)) {
              throw new Error("Invalid sales type");
            }
            const warehouseId = String(body.warehouseId ?? "");

            const warehouse = await tx.warehouse.findUnique({
              where: { id: warehouseId },
              include: { location: true },
            });

            if (!warehouse?.isActive ||
                !warehouse.location.isActive ||
                warehouse.type !== "MAIN") {
              throw new Error("Invalid or inactive sales warehouse");
            }

            if (body.locationId && body.locationId !== warehouse.locationId) {
              throw new Error("Sales warehouse and location mismatch");
            }

            const discount = Number(body.discountAmount ?? 0);
            const currency = String(body.currency ?? "BDT");
            const fx = Number(body.exchangeRate ?? 1);

            if (!/^[A-Z]{3}$/.test(currency)) {
              throw new Error("Invalid currency code");
            }

            if (items.some(i =>
              !D(i.unitPrice).eq(D(i.unitPrice).toDecimalPlaces(2))
            )) {
              throw new Error("Unit price supports a maximum of two decimal places");
            }

            for (const item of items) {
              await tx.$queryRaw`
                SELECT "id"
                FROM "FinishedStock"
                WHERE "variantId" = ${item.variantId}
                  AND "warehouseId" = ${warehouseId}
                FOR UPDATE
              `;
            }

            // Stock check + decimal-based COGS.
            let subtotal = D(0);
            let cogs = D(0);
            const costs = new Map<string, Prisma.Decimal>();
            for (const i of items) {
              const stock = await tx.finishedStock.findUnique({ where: { variantId_warehouseId: { variantId: i.variantId, warehouseId } } });
              if (!stock ||
                  stock.qty - stock.reservedQty < i.qty) {
                const v = await tx.productVariant.findUnique({ where: { id: i.variantId } });
                throw new Error(`Insufficient stock for ${v?.sku ?? i.variantId}: available ${stock?.qty ?? 0}, requested ${i.qty}`);
              }
              if (stock.qualityStatus !== "PASSED") {
                throw new Error("Only QC-passed products can be sold");
              }

              if (!D(stock.unitCost).isFinite() ||
                  D(stock.unitCost).lte(0)) {
                throw new Error("Product inventory cost requires reconciliation");
              }

              subtotal = subtotal.add(D(i.unitPrice).mul(i.qty));
              cogs = cogs.add(D(stock.unitCost).mul(i.qty));
              costs.set(i.variantId, stock.unitCost);
            }
            if (!Number.isFinite(discount) ||
                discount < 0 ||
                D(discount).gt(subtotal) ||
                !D(discount).eq(D(discount).toDecimalPlaces(2)) ||
                !Number.isFinite(fx) ||
                fx <= 0 ||
                (currency === "BDT" && fx !== 1)) {
              throw new Error("Invalid discount or exchange rate");
            }

            const total = subtotal.sub(discount).toDecimalPlaces(2);

            const discountAllocation = new Map<string, Prisma.Decimal>();
            let allocatedDiscount = D(0);
            items.forEach((item, index) => {
              const gross = D(item.unitPrice).mul(item.qty);
              const part = index === items.length - 1
                ? D(discount).sub(allocatedDiscount)
                : gross.div(subtotal).mul(discount).toDecimalPlaces(2);
              allocatedDiscount = allocatedDiscount.add(part);
              discountAllocation.set(item.variantId, part);
            });

            if (total.lte(0)) {
              throw new Error("Sales invoice total must be positive");
            }

            const paidNow = Number(body.paidAmount ?? 0);

            if (!Number.isFinite(paidNow) ||
                paidNow < 0 ||
                D(paidNow).gt(total) ||
                !D(paidNow).eq(D(paidNow).toDecimalPlaces(2))) {
              throw new Error("Invalid initial payment amount");
            }
            const payCode = paidNow > 0 ? await nextDocNo(tx, "PAY") : null;
            const invoice = await tx.salesInvoice.create({
              data: {
                code, customerId, type: saleType,
                locationId: warehouse.locationId, warehouseId,
                currency, exchangeRate: D(fx),
                subtotal: D(subtotal), discountAmount: D(discount), total: D(total),
                cogs: cogs.toDecimalPlaces(2), status: "CONFIRMED", createdById: user.id,
                isDemo: Boolean(body.isDemo), notes: body.notes as string | undefined,
                items: {
                  create: items.map((i) => ({
                    variantId: i.variantId, qty: i.qty, unitPrice: D(i.unitPrice), unitCost: D(costs.get(i.variantId)),
                    lineTotal: D(i.unitPrice).mul(i.qty)
                      .sub(discountAllocation.get(i.variantId) ?? D(0))
                      .toDecimalPlaces(2),
                  })),
                },
              },
            });
            // inventory out + COGS
            for (const i of items) {
              await postFinishedMovement(tx, {
                variantId: i.variantId, fromWarehouseId: warehouseId, qty: i.qty, type: "SALE_OUT",
                refType: "SALES_INVOICE", refId: invoice.id, refNo: code, userId: user.id, userName: user.name,
                note: `Sold to ${customer.name}`,
              });
              await tx.productVariant.update({ where: { id: i.variantId }, data: { soldQty: { increment: i.qty } } });
            }
            // revenue + COGS journal
            const totalBdt = total.mul(fx).toDecimalPlaces(2);
            const cogsBdt = cogs.toDecimalPlaces(2);

            if (!totalBdt.isFinite() || totalBdt.lte(0) ||
                !cogsBdt.isFinite() || cogsBdt.lte(0)) {
              throw new Error("Invalid invoice accounting value");
            }
            await postJournal(tx, {
              memo: `Sales invoice ${code} — ${customer.name}`, refType: "SALES_INVOICE", refId: invoice.id, refNo: code, userId: user.id,
              lines: [
                { accountCode: ACC.AR, debit: totalBdt }, // AR
                { accountCode: ACC.SALES, credit: totalBdt },
              ],
            });
            await postJournal(tx, {
              memo: `COGS for ${code}`, refType: "SALES_INVOICE", refId: invoice.id, refNo: code, userId: user.id,
              lines: [
                { accountCode: ACC.COGS, debit: cogsBdt },
                { accountCode: ACC.FG_INV, credit: cogsBdt },
              ],
            });
            // immediate payment
            // Initial payment was validated before invoice creation.
            if (payCode) {
              const account = await tx.account.findFirstOrThrow({ where: { ...(body.paymentAccountId ? { id: String(body.paymentAccountId) } : { code: String(body.paymentAccountCode ?? "1010") }), type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } } });
              const paidBdt = D(paidNow).mul(fx).toDecimalPlaces(2);

              if (!account.isActive || account.currency !== "BDT") {
                throw new Error("An active BDT payment account is required");
              }

              if (paidBdt.lte(0)) {
                throw new Error("Converted payment must be positive");
              }
              const initialPayment = await tx.payment.create({
                data: {
                  code: payCode, direction: "IN", partnerId: customerId,
                  salesInvoiceId: invoice.id, accountId: account.id,
                  amount: D(paidBdt), method: String(body.paymentMethod ?? "CASH"), createdById: user.id,
                },
              });
              await tx.salesInvoice.update({ where: { id: invoice.id }, data: { paidAmount: D(paidNow), status: D(paidNow).eq(total) ? "PAID" : "PARTIAL" } });
              await postJournal(tx, {
                memo: `Customer payment ${payCode} for ${code}`, refType: "PAYMENT", refId: initialPayment.id, refNo: payCode, userId: user.id,
                lines: [
                  { accountCode: account.code, debit: paidBdt },
                  { accountCode: ACC.AR, credit: paidBdt },
                ],
              });
            }
            await logActivity(tx, { module: "SALES", action: "sale_recorded", description: `Sales invoice ${code} — ${customer.name}, ${items.reduce((a, i) => a + i.qty, 0)} pc, ৳${totalBdt.toFixed(2)}`, userName: user.name, refNo: code, amount: totalBdt });
            if (request) {
              await tx.salesRequest.update({
                where: { key: request.key },
                data: { resourceId: invoice.id },
              });
            }

            const postedInvoice = await tx.salesInvoice.findUniqueOrThrow({
              where: { id: invoice.id },
            });

            return { invoice: postedInvoice, duplicate: false };
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "payment": {
        try {
          const result = await db.$transaction(async (tx) => {
            const request = await claimTransactionRequest(
              tx, "SALE_PAYMENT", body, user.id
            );

            if (request?.resourceId) {
              return tx.payment.findUniqueOrThrow({
                where: { id: request.resourceId },
              });
            }

            const invoiceId = String(body.invoiceId);

            const code = await nextDocNo(tx, "PAY");

            await tx.$queryRaw`
              SELECT "id"
              FROM "SalesInvoice"
              WHERE "id" = ${invoiceId}
              FOR UPDATE
            `;

            const invoice = await tx.salesInvoice.findUnique({
              where: { id: invoiceId },
              include: { customer: true },
            });

            if (!invoice ||
                !["CONFIRMED", "PARTIAL"].includes(invoice.status)) {
              throw new Error("Invoice not found or not payable");
            }
            const outstanding = D(invoice.total).sub(invoice.paidAmount);

            const amount = Number(body.amount ?? outstanding);

            if (!Number.isFinite(amount) ||
                amount <= 0 ||
                D(amount).gt(outstanding) ||
                !D(amount).eq(D(amount).toDecimalPlaces(2))) {
              throw new Error(`Invalid payment amount (outstanding ${invoice.currency} ${outstanding.toFixed(2)})`);
            }
            const account = await tx.account.findFirstOrThrow({ where: { ...(body.accountId ? { id: String(body.accountId) } : { code: String(body.accountCode ?? "1010") }), type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } } });
            if (!account.isActive || account.currency !== "BDT") {
              throw new Error("An active BDT payment account is required");
            }

            if (!D(invoice.exchangeRate).isFinite() ||
                D(invoice.exchangeRate).lte(0)) {
              throw new Error("Invalid invoice exchange rate");
            }

            const cumulativePaid = D(invoice.paidAmount).add(amount);

            const amountBdt = cumulativePaid.mul(invoice.exchangeRate).toDecimalPlaces(2)
              .sub(D(invoice.paidAmount).mul(invoice.exchangeRate).toDecimalPlaces(2));

            if (amountBdt.lte(0)) {
              throw new Error("Converted payment must be positive");
            }
            const payment = await tx.payment.create({
              data: {
                code, direction: "IN", partnerId: invoice.customerId, salesInvoiceId: invoice.id,
                accountId: account.id, amount: amountBdt,
                method: String(body.method ?? "CASH"), createdById: user.id,
              },
            });
            const newPaid = cumulativePaid;
            const updated = await tx.salesInvoice.updateMany({
              where: { id: invoice.id, paidAmount: invoice.paidAmount, status: invoice.status },
              data: {
                paidAmount: newPaid,
                status: newPaid.eq(invoice.total) ? "PAID" : "PARTIAL",
              },
            });
            if (updated.count !== 1) throw new Error("Invoice changed; retry payment");
            await postJournal(tx, {
              memo: `Receipt ${code} from ${invoice.customer.name} for ${invoice.code}`, refType: "PAYMENT", refId: payment.id, refNo: code, userId: user.id,
              lines: [
                { accountCode: account.code, debit: amountBdt },
                { accountCode: ACC.AR, credit: amountBdt },
              ],
            });
            await logActivity(tx, { module: "SALES", action: "payment_received", description: `Received ৳${amount.toLocaleString()} from ${invoice.customer.name} (${invoice.code})`, userName: user.name, refNo: code, amount });
            if (request) {
              await tx.salesRequest.update({
                where: { key: request.key },
                data: { resourceId: payment.id },
              });
            }

            return payment;
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "cancel": {
        return bad("Posted sales cannot be cancelled without reversing stock, payments and journals; use an audited return workflow", 409);
      }
    }
  }
  return bad(`Unknown finance action: ${resource}/${action ?? ""}`, 404);
}
