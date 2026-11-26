import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q, qDate } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, nextDocNo, logAudit, logActivity, postJournal, ACC, postCashMovement, reverseJournal } from "../core";
import { postFinishedMovement } from "../inventory";

// ───────────────────────── GET ─────────────────────────
export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, "view_financial");
  if ("error" in auth) return auth.error;

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
      include: { customer: true, items: { include: { variant: true } } },
      orderBy: { invoiceDate: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "statements") {
    const type = q(req, "type") ?? "trial";
    const from = qDate(req, "from") ?? new Date(2000, 0, 1);
    const to = qDate(req, "to") ?? new Date();
    const entries = await db.journalEntry.findMany({
      where: { date: type === "bs" || type === "trial" ? { lte: to } : { gte: from, lte: to } },
      include: { lines: { include: { account: true } } },
    });
    const accounts = await db.account.findMany({ orderBy: { code: "asc" } });
    const balances = new Map<string, { debit: number; credit: number }>();
    for (const a of accounts) balances.set(a.id, { debit: 0, credit: 0 });
    for (const e of entries) {
      for (const l of e.lines) {
        const b = balances.get(l.accountId)!;
        b.debit += N(l.debit); b.credit += N(l.credit);
      }
    }
    if (type === "trial") {
      const rows = accounts.map((a) => {
        const b = balances.get(a.id)!;
        const net = b.debit - b.credit;
        return { code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
      }).filter((r) => r.debit !== 0 || r.credit !== 0);
      return ok({ type, rows, totalDebit: rows.reduce((s, r) => s + r.debit, 0), totalCredit: rows.reduce((s, r) => s + r.credit, 0) });
    }
    if (type === "pl") {
      const income = accounts.filter((a) => a.type === "INCOME").map((a) => ({ code: a.code, name: a.name, amount: (balances.get(a.id)!.credit - balances.get(a.id)!.debit) }));
      const expense = accounts.filter((a) => a.type === "EXPENSE").map((a) => ({ code: a.code, name: a.name, amount: (balances.get(a.id)!.debit - balances.get(a.id)!.credit) }));
      const totalIncome = income.reduce((s, r) => s + r.amount, 0);
      const totalExpense = expense.reduce((s, r) => s + r.amount, 0);
      return ok({ type, income: income.filter((r) => r.amount !== 0), expense: expense.filter((r) => r.amount !== 0), totalIncome, totalExpense, netProfit: totalIncome - totalExpense });
    }
    if (type === "bs") {
      const assets = accounts.filter((a) => ["CASH", "BANK", "MOBILE_BANKING", "RECEIVABLE", "INVENTORY", "ADVANCE", "TAX"].includes(a.type)).map((a) => ({ code: a.code, name: a.name, amount: balances.get(a.id)!.debit - balances.get(a.id)!.credit }));
      const liabilities = accounts.filter((a) => ["PAYABLE"].includes(a.type)).map((a) => ({ code: a.code, name: a.name, amount: balances.get(a.id)!.credit - balances.get(a.id)!.debit }));
      const equity = accounts.filter((a) => a.type === "EQUITY").map((a) => ({ code: a.code, name: a.name, amount: balances.get(a.id)!.credit - balances.get(a.id)!.debit }));
      // include current period profit in equity
      const entriesAll = await db.journalEntry.findMany({ where: { date: { lte: to } }, include: { lines: { include: { account: true } } } });
      let profit = 0;
      for (const e of entriesAll) {
        for (const l of e.lines) {
          const acc = accounts.find((x) => x.id === l.accountId);
          if (!acc) continue;
          if (acc.type === "INCOME") profit += N(l.credit) - N(l.debit);
          if (acc.type === "EXPENSE") profit -= N(l.debit) - N(l.credit);
        }
      }
      equity.push({ code: "3900", name: "Retained Earnings (Current)", amount: profit });
      return ok({ type, assets: assets.filter((r) => r.amount !== 0), liabilities: liabilities.filter((r) => r.amount !== 0), equity: equity.filter((r) => r.amount !== 0), totalAssets: assets.reduce((s, r) => s + r.amount, 0), totalLiabilities: liabilities.reduce((s, r) => s + r.amount, 0), totalEquity: equity.reduce((s, r) => s + r.amount, 0) });
    }
    if (type === "cashflow") {
      const cashAccounts = accounts.filter((a) => ["CASH", "BANK", "MOBILE_BANKING"].includes(a.type));
      const cashIds = new Set(cashAccounts.map((a) => a.id));
      const flows = new Map<string, { inflow: number; outflow: number }>();
      for (const e of entries) {
        for (const l of e.lines) {
          if (!cashIds.has(l.accountId)) continue;
          const acc = accounts.find((x) => x.id === l.accountId)!;
          const bucket = acc.type === "BANK" ? "Bank" : acc.type === "MOBILE_BANKING" ? "Mobile Banking" : "Cash";
          const cur = flows.get(bucket) ?? { inflow: 0, outflow: 0 };
          if (N(l.debit) > 0) cur.inflow += N(l.debit);
          if (N(l.credit) > 0) cur.outflow += N(l.credit);
          flows.set(bucket, cur);
        }
      }
      const rows = [...flows.entries()].map(([name, v]) => ({ name, ...v, net: v.inflow - v.outflow }));
      return ok({ type, rows, totalIn: rows.reduce((s, r) => s + r.inflow, 0), totalOut: rows.reduce((s, r) => s + r.outflow, 0), net: rows.reduce((s, r) => s + r.net, 0) });
    }
    return bad("Unknown statement type");
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
        if (amount <= 0) throw new Error("Amount must be positive");
        const category = String(body.category ?? "Miscellaneous");
        const accountCode = String(body.accountCode ?? "1010");
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
        await reverseJournal(tx, String(body.id), user.id, String(body.reason ?? "Reversal"));
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
            const idem = body.idempotencyKey as string | undefined;
            const code = await nextDocNo(tx, "SI");
            const customerId = String(body.customerId);
            const customer = await tx.businessPartner.findUnique({ where: { id: customerId } });
            if (!customer) throw new Error("Customer not found");
            const items = (body.items ?? []) as { variantId: string; qty: number; unitPrice: number }[];
            if (!items.length || items.some(i => !Number.isSafeInteger(i.qty) || i.qty <= 0 || !Number.isFinite(i.unitPrice) || i.unitPrice < 0)) throw new Error("Invalid sale items");
            const warehouseId = String(body.warehouseId);
            const discount = Number(body.discountAmount ?? 0);
            const currency = String(body.currency ?? "BDT");
            const fx = Number(body.exchangeRate ?? 1);

            // stock check + COGS
            let subtotal = 0, cogs = 0;
            const costs = new Map<string, number>();
            for (const i of items) {
              const stock = await tx.finishedStock.findUnique({ where: { variantId_warehouseId: { variantId: i.variantId, warehouseId } } });
              if (!stock || stock.qty < i.qty) {
                const v = await tx.productVariant.findUnique({ where: { id: i.variantId } });
                throw new Error(`Insufficient stock for ${v?.sku ?? i.variantId}: available ${stock?.qty ?? 0}, requested ${i.qty}`);
              }
              subtotal += i.qty * i.unitPrice;
              cogs += i.qty * Number(stock.unitCost);
              costs.set(i.variantId, Number(stock.unitCost));
            }
            if (!Number.isFinite(discount) || discount < 0 || discount > subtotal || !Number.isFinite(fx) || fx <= 0 || (currency === "BDT" && fx !== 1)) throw new Error("Invalid discount or exchange rate");
            const total = subtotal - discount;
            const invoice = await tx.salesInvoice.create({
              data: {
                code, customerId, type: String(body.type ?? "WHOLESALE"),
                locationId: (body.locationId as string) || null, warehouseId,
                currency, exchangeRate: D(fx),
                subtotal: D(subtotal), discountAmount: D(discount), total: D(total),
                cogs: D(Math.round(cogs * 100) / 100), status: "CONFIRMED", createdById: user.id,
                isDemo: Boolean(body.isDemo), notes: body.notes as string | undefined,
                items: {
                  create: items.map((i) => ({
                    variantId: i.variantId, qty: i.qty, unitPrice: D(i.unitPrice), unitCost: D(costs.get(i.variantId)),
                    lineTotal: D(i.qty * i.unitPrice),
                  })),
                },
              },
            });
            // inventory out + COGS
            for (const i of items) {
              const stock = await tx.finishedStock.findUniqueOrThrow({ where: { variantId_warehouseId: { variantId: i.variantId, warehouseId } } });
              await postFinishedMovement(tx, {
                variantId: i.variantId, fromWarehouseId: warehouseId, qty: i.qty, type: "SALE_OUT",
                refType: "SALES_INVOICE", refId: invoice.id, refNo: code, userId: user.id, userName: user.name,
                note: `Sold to ${customer.name}`,
              });
              await tx.productVariant.update({ where: { id: i.variantId }, data: { soldQty: { increment: i.qty } } });
            }
            // revenue + COGS journal
            const totalBdt = currency === "BDT" ? total : total * fx;
            const cogsBdt = cogs;
            await postJournal(tx, {
              memo: `Sales invoice ${code} — ${customer.name}`, refType: "SALES_INVOICE", refId: invoice.id, refNo: code, userId: user.id,
              lines: [
                { accountCode: String(body.paidNow ? "1200" : "1200"), debit: totalBdt }, // AR
                { accountCode: ACC.SALES, credit: totalBdt },
              ],
            });
            await postJournal(tx, {
              memo: `COGS for ${code}`, refType: "SALES_INVOICE", refId: invoice.id, refNo: code, userId: user.id,
              lines: [
                { accountCode: ACC.COGS, debit: Math.round(cogsBdt * 100) / 100 },
                { accountCode: ACC.FG_INV, credit: Math.round(cogsBdt * 100) / 100 },
              ],
            });
            // immediate payment
            const paidNow = Number(body.paidAmount ?? 0);
            if (!Number.isFinite(paidNow) || paidNow < 0) throw new Error("Invalid payment amount");
            if (paidNow > 0) {
              const account = await tx.account.findFirstOrThrow({ where: { ...(body.paymentAccountId ? { id: String(body.paymentAccountId) } : { code: String(body.paymentAccountCode ?? "1010") }), type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } } });
              const paidBdt = paidNow * fx;
              if (paidNow > total + 0.01) throw new Error("Payment exceeds invoice total");
              const payCode = await nextDocNo(tx, "PAY");
              await tx.payment.create({
                data: {
                  code: payCode, direction: "IN", partnerId: customerId,
                  salesInvoiceId: invoice.id, accountId: account.id,
                  amount: D(paidBdt), method: String(body.paymentMethod ?? "CASH"), createdById: user.id,
                },
              });
              await tx.salesInvoice.update({ where: { id: invoice.id }, data: { paidAmount: D(paidNow), status: paidNow >= total - 0.01 ? "PAID" : "PARTIAL" } });
              await postJournal(tx, {
                memo: `Customer payment ${payCode} for ${code}`, refType: "PAYMENT", refNo: payCode, userId: user.id,
                lines: [
                  { accountCode: account.code, debit: paidBdt },
                  { accountCode: ACC.AR, credit: paidBdt },
                ],
              });
            }
            await logActivity(tx, { module: "SALES", action: "sale_recorded", description: `Sales invoice ${code} — ${customer.name}, ${items.reduce((a, i) => a + i.qty, 0)} pc, ৳${Math.round(totalBdt).toLocaleString()}`, userName: user.name, refNo: code, amount: totalBdt });
            return { invoice, duplicate: false };
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "payment": {
        try {
          const result = await db.$transaction(async (tx) => {
            const invoice = await tx.salesInvoice.findUnique({ where: { id: String(body.invoiceId) }, include: { customer: true } });
            if (!invoice || invoice.status === "CANCELLED") throw new Error("Invoice not found or cancelled");
            const amount = Number(body.amount ?? Number(invoice.total) - Number(invoice.paidAmount));
            const outstanding = Number(invoice.total) - Number(invoice.paidAmount);
            if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding + 0.01) throw new Error(`Invalid payment amount (outstanding ৳${outstanding.toFixed(2)})`);
            const code = await nextDocNo(tx, "PAY");
            const account = await tx.account.findFirstOrThrow({ where: { ...(body.accountId ? { id: String(body.accountId) } : { code: String(body.accountCode ?? "1010") }), type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } } });
            const amountBdt = amount * Number(invoice.exchangeRate);
            const payment = await tx.payment.create({
              data: {
                code, direction: "IN", partnerId: invoice.customerId, salesInvoiceId: invoice.id,
                accountId: account.id, amount: D(amountBdt),
                method: String(body.method ?? "CASH"), createdById: user.id,
              },
            });
            const newPaid = Number(invoice.paidAmount) + amount;
            const updated = await tx.salesInvoice.updateMany({
              where: { id: invoice.id, paidAmount: invoice.paidAmount, status: invoice.status },
              data: { paidAmount: D(newPaid), status: newPaid >= Number(invoice.total) - 0.01 ? "PAID" : "PARTIAL" },
            });
            if (updated.count !== 1) throw new Error("Invoice changed; retry payment");
            await postJournal(tx, {
              memo: `Receipt ${code} from ${invoice.customer.name} for ${invoice.code}`, refType: "PAYMENT", refNo: code, userId: user.id,
              lines: [
                { accountCode: account.code, debit: amountBdt },
                { accountCode: ACC.AR, credit: amountBdt },
              ],
            });
            await logActivity(tx, { module: "SALES", action: "payment_received", description: `Received ৳${amount.toLocaleString()} from ${invoice.customer.name} (${invoice.code})`, userName: user.name, refNo: code, amount });
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
