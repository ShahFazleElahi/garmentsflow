import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q, canAccessWarehouses } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, nextDocNo, logAudit, logActivity, postJournal, ACC, payableAccountFor, claimTransactionRequest } from "../core";
import { postMaterialMovement, postReceiptAccounting } from "../inventory";
import { Prisma } from "@prisma/client";
import { can, scopedLocations } from "../auth";

// ───────────────────────── GET ─────────────────────────
export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, ["invoices", "payments"].includes(resource) ? "view_financial" : "view");
  if ("error" in auth) return auth.error;
  const financial = can(auth.user, "view_financial");
  const locations = scopedLocations(auth.user);
  if (locations && ["invoices", "payments"].includes(resource)) return bad("Company-wide procurement finance requires unrestricted access", 403);
  const warehouseIds = locations && ["receipts", "returns"].includes(resource)
    ? (await db.warehouse.findMany({ where: { locationId: { in: locations } }, select: { id: true } })).map(row => row.id)
    : null;
  const orders = locations ? { locationId: { in: locations } } : {};
  const warehouse = warehouseIds ? { warehouseId: { in: warehouseIds } } : {};
  const supplier = { omit: { bankInfo: !financial, openingBalance: !financial } };
  const material = { omit: { purchasePrice: !financial, avgCost: !financial } };
  const orderCosts = { subtotal: !financial, discountAmount: !financial, taxAmount: !financial, transportCost: !financial,
    loadingCost: !financial, unloadingCost: !financial, otherCost: !financial, total: !financial, exchangeRate: !financial,
    paidAmount: !financial, advanceAmount: !financial };
  const receiptCosts = { transportCost: !financial, loadingCost: !financial, unloadingCost: !financial, otherCost: !financial, idempotencyKey: true };
  const orderItems = { omit: { unitPrice: !financial, lineTotal: !financial }, include: { material } };
  const receiptItems = { omit: { unitCost: !financial, lineTotal: !financial }, include: { material } };

  if (resource === "orders" && !id) {
    const rows = await db.purchaseOrder.findMany({
      where: orders,
      omit: orderCosts,
      include: { supplier, plan: { select: { code: true, name: true } }, items: orderItems, receipts: { omit: receiptCosts } },
      orderBy: { orderDate: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "orders" && id) {
    const row = await db.purchaseOrder.findFirst({
      where: { id, ...orders },
      omit: orderCosts,
      include: { supplier, plan: { select: { id: true, code: true, name: true } }, items: orderItems,
        receipts: { omit: receiptCosts, include: { items: receiptItems } } },
    });
    if (!row) return bad("Purchase order not found", 404);
    return ok(ser(row));
  }
  if (resource === "receipts") {
    const rows = await db.materialReceipt.findMany({
      where: warehouse, omit: receiptCosts,
      include: { items: receiptItems, po: { omit: orderCosts, include: { supplier } } },
      orderBy: { receiptDate: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "returns") {
    const rows = await db.purchaseReturn.findMany({ where: warehouse, omit: { totalAmount: !financial, itemsJson: !financial }, orderBy: { returnDate: "desc" } });
    return ok(ser(rows));
  }
  if (resource === "invoices") {
    const rows = await db.vendorInvoice.findMany({ include: { partner: true }, orderBy: { date: "desc" } });
    return ok(ser(rows));
  }
  if (resource === "payments") {
    const rows = await db.payment.findMany({ orderBy: { date: "desc" }, take: 200 });
    return ok(ser(rows));
  }
  if (resource === "requirements") {
    // open material shortages → suggested purchase lines (supplier grouped)
    const reqs = await db.materialRequirement.findMany({
      where: { suggestedQty: { gt: 0 } },
      omit: { estCost: !financial },
      include: { material: { ...material, include: { category: true } }, plan: { select: { id: true, code: true, name: true } } },
    });
    return ok(ser(reqs));
  }
  return bad(`Unknown procurement resource: ${resource}`, 404);
}

// ───────────────────────── POST ─────────────────────────
export async function handlePost(segments: string[], body: Record<string, unknown>, req: NextRequest) {
  const [resource, action] = segments;
  const auth = await requirePerm(req, action === "cancel" ? "cancel" : action === "receive" || action === "pay" ? "post" : "create");
  if ("error" in auth) return auth.error;
  const { user } = auth;
  if (["payments", "invoices"].includes(resource) && !user.permissions.includes("*") && !user.permissions.includes("view_financial")) return bad("Permission denied: view_financial", 403);

  if (resource === "orders") {
    switch (action) {
      case "create": {
        try {
          const result = await db.$transaction(async (tx) => {
            const request = await claimTransactionRequest(tx, "PURCHASE_ORDER", body, user.id);
            if (request?.resourceId) return tx.purchaseOrder.findUniqueOrThrow({ where: { id: request.resourceId }, include: { items: true } });
            const items = body.items as { materialId: string; qty: number; unitPrice: number; unit?: string; colorName?: string; shade?: string }[];
            if (!Array.isArray(items) || !items.length || items.some(item => !item || typeof item.materialId !== "string" ||
                !item.materialId || !Number.isFinite(item.qty) || item.qty <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)) {
              throw new Error("Valid material quantities and prices required");
            }
            const supplier = await tx.businessPartner.findFirst({ where: { id: String(body.supplierId), isActive: true, type: "SUPPLIER" } });
            if (!supplier) throw new Error("Active supplier not found");
            const warehouseId = typeof body.warehouseId === "string" && body.warehouseId ? body.warehouseId : null;
            const warehouse = warehouseId ? await tx.warehouse.findFirst({
              where: { id: warehouseId, type: "MAIN", isActive: true, location: { isActive: true } },
            }) : null;
            if (warehouseId && (!warehouse || !await canAccessWarehouses(user, [warehouseId]) ||
                (body.locationId && body.locationId !== warehouse.locationId))) {
              throw new Error("An accessible active main warehouse matching the order location is required");
            }
            const subtotal = items.reduce((sum, item) => sum.add(D(item.qty).mul(item.unitPrice)), D(0)).toDecimalPlaces(2);
            const charges = ["discountAmount", "taxAmount", "transportCost", "loadingCost", "unloadingCost", "otherCost", "advanceAmount"]
              .map(key => Number(body[key] ?? 0));
            if (charges.some(value => !Number.isFinite(value) || value < 0 || !D(value).eq(D(value).toDecimalPlaces(2)))) {
              throw new Error("Order charges and advances must be non-negative currency amounts");
            }
            const [discount, tax, transport, loading, unloading, other, advance] = charges.map(D);
            if (discount.gt(subtotal) || (tax.gt(0) && subtotal.isZero())) throw new Error("Order discount or tax exceeds the supported material value");
            const total = subtotal.sub(discount).add(tax).add(transport).add(loading).add(unloading).add(other);
            const currency = String(body.currency ?? "BDT");
            const exchangeRate = Number(body.exchangeRate ?? 1);
            if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(exchangeRate) || exchangeRate <= 0 ||
                (currency === "BDT" && exchangeRate !== 1) || advance.gt(total)) throw new Error("Invalid order currency, exchange rate or advance");
            const account = advance.gt(0) && currency === "BDT" ? await tx.account.findFirst({
              where: { ...(body.accountId ? { id: String(body.accountId) } : { code: String(body.accountCode ?? "1010") }),
                currency: "BDT", isActive: true, type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } },
            }) : null;
            if (advance.gt(0) && !account) throw new Error("An active BDT payment account is required for the advance");
            const code = await nextDocNo(tx, "PO");
            const po = await tx.purchaseOrder.create({
              data: {
                code, supplierId: supplier.id, planId: (body.planId as string) || null,
                type: String(body.type ?? "PO"), status: "ORDERED",
                orderDate: body.orderDate ? new Date(String(body.orderDate)) : new Date(),
                expectedDate: body.expectedDate ? new Date(String(body.expectedDate)) : undefined,
                locationId: warehouse?.locationId ?? (typeof body.locationId === "string" ? body.locationId : null), warehouseId,
                subtotal: D(subtotal), discountAmount: D(discount), taxAmount: D(tax),
                transportCost: D(transport), loadingCost: D(loading), unloadingCost: D(unloading), otherCost: D(other),
                total, currency, exchangeRate: D(exchangeRate),
                advanceAmount: advance, paidAmount: advance,
                dueDate: body.dueDate ? new Date(String(body.dueDate)) : undefined,
                notes: body.notes as string | undefined, createdById: user.id,
                items: {
                  create: items.map((i) => ({
                    materialId: i.materialId, qty: D(i.qty), unit: i.unit ?? "Yard",
                    unitPrice: D(i.unitPrice), lineTotal: D(i.qty).mul(i.unitPrice).toDecimalPlaces(2),
                    colorName: i.colorName, shade: i.shade,
                  })),
                },
              },
              include: { items: true },
            });
            // advance payment handling
            if (account) {
              await tx.vendorInvoice.create({
                data: {
                  invoiceNo: `${po.code}-ADV`, partnerId: supplier.id, poId: po.id,
                  date: new Date(), amount: D(advance), paidAmount: D(advance), status: "PAID",
                  notes: "Advance payment against PO",
                },
              });
              await tx.payment.create({
                data: {
                  code: await nextDocNo(tx, "PAY"), direction: "OUT", partnerId: supplier.id,
                  accountId: account.id, amount: advance, method: String(body.paymentMethod ?? "CASH"),
                  notes: `Advance for ${po.code}`, createdById: user.id,
                },
              });
              await postJournal(tx, {
                memo: `Advance payment for ${po.code}`, refType: "PURCHASE_ORDER", refId: po.id, refNo: po.code, userId: user.id,
                lines: [
                  { accountCode: ACC.ADVANCE, debit: advance },
                  { accountCode: account.code, credit: advance },
                ],
              });
            }
            await logAudit(tx, { userId: user.id, userName: user.name, action: "CREATE", entity: "PurchaseOrder", entityId: po.id, refNo: po.code, newJson: { total } });
            await logActivity(tx, { module: "PROCUREMENT", action: "po_created", description: `Purchase order ${po.code} — ${supplier.name}, ${items.length} material line(s), ৳${total.toLocaleString()}`, userName: user.name, planId: (body.planId as string) || undefined, refNo: po.code, amount: total });
            if (request) await tx.salesRequest.update({ where: { key: request.key }, data: { resourceId: po.id } });
            return po;
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "cancel": {
        try {
          const order = await db.$transaction(async tx => {
            const id = String(body.id);
            await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} FOR UPDATE`;
            const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { _count: { select: { receipts: true, vendorInvoices: true } } } });
            if (po.status === "CANCELLED") return po;
            if (po.status !== "ORDERED" || po._count.receipts || po._count.vendorInvoices || !po.advanceAmount.isZero() || !po.paidAmount.isZero()) {
              throw new Error("Posted purchase orders require inventory and accounting reconciliation");
            }
            if (po.warehouseId && !await canAccessWarehouses(user, [po.warehouseId])) throw new Error("Warehouse access denied");
            const cancelled = await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
            await logActivity(tx, { module: "PROCUREMENT", action: "po_cancelled", description: `Purchase order ${po.code} cancelled`, userName: user.name, refNo: po.code });
            return cancelled;
          });
          return ok(ser(order));
        } catch (error) {
          return bad((error as Error).message, 409);
        }
      }
      case "receive": {
        try {
          const result = await db.$transaction(async (tx) => {
            const poId = String(body.poId);
            const idem = body.idempotencyKey as string | undefined;
            const request = await claimTransactionRequest(tx, "MATERIAL_RECEIPT", body, user.id);
            if (request?.resourceId) return { receipt: await tx.materialReceipt.findUniqueOrThrow({ where: { id: request.resourceId } }), duplicate: true };
            await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${poId} FOR UPDATE`;
            if (idem) {
              const dupe = await tx.materialReceipt.findUnique({ where: { idempotencyKey: idem } });
              if (dupe) {
                if (dupe.poId !== poId) throw new Error("Idempotency key belongs to another purchase order");
                return { receipt: dupe, duplicate: true };
              }
            }
            const po = await tx.purchaseOrder.findUnique({
              where: { id: poId },
              include: { items: true, supplier: true },
            });
            if (!po) throw new Error("Purchase order not found");
            if (!["ORDERED", "PARTIAL"].includes(po.status)) throw new Error("Purchase order is closed to new receipts");
            if (po.currency !== "BDT" || !po.exchangeRate.eq(1)) throw new Error("Foreign-currency receipts require FX reconciliation");
            if (po.discountAmount.gt(0) || po.taxAmount.gt(0) || po.advanceAmount.gt(0)) {
              const priorReceipts = await tx.materialReceipt.findMany({ where: { poId }, select: { id: true } });
              const reconciled = await tx.auditLog.count({
                where: { action: "POST", entity: "MaterialReceipt", entityId: { in: priorReceipts.map(row => row.id) } },
              });
              if (reconciled !== priorReceipts.length) throw new Error("Earlier purchase receipts require tax, discount or advance reconciliation");
            }

            const lines = (body.items ?? []) as { poItemId?: string; materialId: string; qty: number; unitPrice?: number }[];
            if (!Array.isArray(lines) || !lines.length || lines.some(line => {
              const ordered = po.items.find(item => item.id === line?.poItemId);
              return !ordered || ordered.materialId !== line.materialId || !Number.isFinite(line.qty) || line.qty <= 0 ||
                (line.unitPrice !== undefined && (!Number.isFinite(line.unitPrice) || !D(line.unitPrice).eq(ordered.unitPrice)));
            }) || new Set(lines.map(line => line.poItemId)).size !== lines.length) throw new Error("Receipt requires distinct matching purchase lines and valid quantities");
            const warehouseId = String(body.warehouseId ?? po.warehouseId ?? "");
            if (!await canAccessWarehouses(user, [warehouseId]) || !await tx.warehouse.count({
              where: { id: warehouseId, type: "MAIN", isActive: true, location: { isActive: true } },
            })) throw new Error("An accessible active main destination warehouse is required");
            if (po.warehouseId && po.warehouseId !== warehouseId) throw new Error("Receiving warehouse must match the purchase order");

            const transport = Number(body.transportCost ?? 0);
            const loading = Number(body.loadingCost ?? 0);
            const unloading = Number(body.unloadingCost ?? 0);
            const other = Number(body.otherCost ?? 0);
            if ([transport, loading, unloading, other].some(value => !Number.isFinite(value) || value < 0 || !D(value).eq(D(value).toDecimalPlaces(2)))) {
              throw new Error("Receiving costs must be non-negative currency amounts");
            }
            const receivingExtras = [transport, loading, unloading, other].reduce((sum, value) => sum.add(value), D(0));
            const orderItems = new Map(po.items.map(item => [item.id, item]));
            const selected = lines.map(line => ({ item: orderItems.get(line.poItemId!)!, qty: D(line.qty) }))
              .sort((a, b) => a.item.id.localeCompare(b.item.id));
            const lineValue = selected.reduce((sum, line) => sum.add(line.qty.mul(line.item.unitPrice)), D(0));
            if (!lineValue.gt(0) && receivingExtras.gt(0)) throw new Error("Receiving costs require a positive material value");
            const orderedValue = po.items.reduce((sum, item) => sum.add(item.qty.mul(item.unitPrice)), D(0));
            const priorValue = po.items.reduce((sum, item) => sum.add(item.receivedQty.mul(item.unitPrice)), D(0));
            const prorate = (amount: Prisma.Decimal) => orderedValue.gt(0)
              ? amount.mul(priorValue.add(lineValue)).div(orderedValue).toDecimalPlaces(2)
                .sub(amount.mul(priorValue).div(orderedValue).toDecimalPlaces(2))
              : D(0);
            const discount = prorate(po.discountAmount);
            const tax = prorate(po.taxAmount);
            const totalValue = lineValue.sub(discount).add(receivingExtras).toDecimalPlaces(2);
            if (totalValue.lt(0) || tax.lt(0)) throw new Error("Receipt costs require reconciliation");
            const invoiceAmount = totalValue.add(tax);
            let appliedAdvance = D(0);
            if (po.advanceAmount.gt(0)) {
              const movements = await tx.journalLine.findMany({
                where: { account: { code: ACC.ADVANCE }, entry: {
                  reversedAt: null, reversalOfId: null, OR: [
                    { refType: "PURCHASE_ORDER", refId: po.id },
                    { refType: "PURCHASE_ADVANCE_APPLIED", refNo: po.code },
                  ],
                } },
                select: { debit: true, credit: true, entry: { select: { refType: true } } },
              });
              const funded = movements.filter(line => line.entry.refType === "PURCHASE_ORDER").reduce((sum, line) => sum.add(line.debit).sub(line.credit), D(0));
              const applied = movements.filter(line => line.entry.refType === "PURCHASE_ADVANCE_APPLIED").reduce((sum, line) => sum.add(line.credit).sub(line.debit), D(0));
              if (!funded.eq(po.advanceAmount) || applied.lt(0) || applied.gt(funded)) throw new Error("Purchase advance requires journal reconciliation");
              appliedAdvance = Prisma.Decimal.min(invoiceAmount, funded.sub(applied));
            }

            const code = await nextDocNo(tx, "GRN");
            const receipt = await tx.materialReceipt.create({
              data: {
                code, poId: po.id, supplierId: po.supplierId, warehouseId,
                receiptDate: body.receiptDate ? new Date(String(body.receiptDate)) : new Date(),
                receivedById: user.id, transportCost: D(transport), loadingCost: D(loading),
                unloadingCost: D(unloading), otherCost: D(other),
                notes: body.notes as string | undefined, idempotencyKey: idem,
              },
            });

            let grossToDate = D(0);
            let allocated = D(0);
            for (const { item, qty } of selected) {
              const newReceived = item.receivedQty.add(qty);
              if (newReceived.gt(item.qty)) throw new Error(`Over-receiving prevented: ${item.materialId} would exceed ordered quantity`);
              grossToDate = grossToDate.add(qty.mul(item.unitPrice));
              const cumulative = lineValue.gt(0) ? totalValue.mul(grossToDate).div(lineValue).toDecimalPlaces(2) : D(0);
              const lineTotal = cumulative.sub(allocated);
              const landedUnit = lineTotal.div(qty);
              allocated = cumulative;
              await tx.materialReceiptItem.create({
                data: {
                  receiptId: receipt.id, poItemId: item.id, materialId: item.materialId, qty, unit: item.unit,
                  unitCost: landedUnit.toDecimalPlaces(4), lineTotal,
                },
              });
              await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: newReceived } });
              await postMaterialMovement(tx, {
                materialId: item.materialId, toWarehouseId: warehouseId, qty,
                unitCost: landedUnit, type: "RECEIPT", refType: "MATERIAL_RECEIPT",
                refId: receipt.id, refNo: code, userId: user.id, userName: user.name, note: `Received against ${po.code}`,
              });
            }

            await tx.vendorInvoice.create({
              data: {
                invoiceNo: body.supplierInvoiceNo as string || `${code}-INV`,
                partnerId: po.supplierId, poId: po.id, date: new Date(),
                amount: invoiceAmount, paidAmount: appliedAdvance,
                status: invoiceAmount.eq(appliedAdvance) ? "PAID" : appliedAdvance.gt(0) ? "PARTIAL" : "OPEN",
                notes: `Goods received ${code}`,
              },
            });
            await postReceiptAccounting(tx, {
              materialValue: totalValue,
              transportCost: 0, loadingCost: 0, unloadingCost: 0, otherCost: 0,
              taxAmount: tax, totalPayable: invoiceAmount, refId: receipt.id, refNo: code, userId: user.id,
            });
            if (appliedAdvance.gt(0)) {
              await postJournal(tx, {
                memo: `Apply advance to ${code}`, refType: "PURCHASE_ADVANCE_APPLIED",
                refId: receipt.id, refNo: po.code, userId: user.id,
                lines: [{ accountCode: ACC.AP_SUPPLIER, debit: appliedAdvance }, { accountCode: ACC.ADVANCE, credit: appliedAdvance }],
              });
            }
            await logAudit(tx, { userId: user.id, userName: user.name, action: "POST", entity: "MaterialReceipt", entityId: receipt.id,
              refNo: code, newJson: { discount, tax, invoiceAmount, appliedAdvance } });

            // PO status
            const refreshed = await tx.purchaseOrder.findUnique({ where: { id: po.id }, include: { items: true } });
            const fully = refreshed!.items.every((i) => D(i.receivedQty).gte(D(i.qty)));
            await tx.purchaseOrder.update({
              where: { id: po.id },
              data: { status: fully ? "RECEIVED" : "PARTIAL", supplierInvoiceNo: (body.supplierInvoiceNo as string) ?? po.supplierInvoiceNo },
            });

            await logActivity(tx, {
              module: "PROCUREMENT", action: "materials_received",
              description: `Materials received ${code} against ${po.code} — ${lines.length} line(s), value ৳${totalValue.toFixed(2)}`,
              userName: user.name, refNo: code, amount: totalValue, planId: po.planId ?? undefined,
            });
            if (request) await tx.salesRequest.update({ where: { key: request.key }, data: { resourceId: receipt.id } });
            return { receipt, duplicate: false };
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
    }
  }

  if (resource === "direct") {
    // Direct purchase + immediate receipt in one transaction
    try {
      const result = await db.$transaction(async (tx) => {
        const idem = body.idempotencyKey as string | undefined;
        if (idem) {
          const dupe = await tx.materialReceipt.findUnique({ where: { idempotencyKey: idem } });
          if (dupe) return { duplicate: true, receipt: dupe };
        }
        const supplierId = String(body.supplierId);
        const warehouseId = String(body.warehouseId);
        const items = (body.items ?? []) as { materialId: string; qty: number; unitPrice: number }[];
        if (!items.length || items.some(i => !Number.isFinite(i.qty) || i.qty <= 0 || !Number.isFinite(i.unitPrice) || i.unitPrice < 0)) throw new Error("Valid material quantities and prices required");
        if (!Number.isFinite(Number(body.transportCost ?? 0)) || Number(body.transportCost ?? 0) < 0) throw new Error("Invalid transport cost");
        const poCode = await nextDocNo(tx, "PO");
        const subtotal = items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
        const total = subtotal + Number(body.transportCost ?? 0);
        const po = await tx.purchaseOrder.create({
          data: {
            code: poCode, supplierId, type: "DIRECT", status: "RECEIVED",
            orderDate: new Date(), warehouseId, subtotal: D(subtotal), total: D(total),
            notes: "Direct purchase", createdById: user.id,
            items: { create: items.map((i) => ({ materialId: i.materialId, qty: D(i.qty), unitPrice: D(i.unitPrice), lineTotal: D(i.qty * i.unitPrice), receivedQty: D(i.qty) })) },
          },
        });
        const code = await nextDocNo(tx, "GRN");
        const receipt = await tx.materialReceipt.create({
          data: {
            code, poId: po.id, supplierId, warehouseId, receivedById: user.id,
            transportCost: D(Number(body.transportCost ?? 0)), idempotencyKey: idem,
            notes: "Direct purchase receipt",
          },
        });
        let totalValue = 0;
        for (const i of items) {
          const qty = D(i.qty);
          const extraShare = subtotal > 0 ? qty.mul(D(i.unitPrice)).div(subtotal).mul(D(Number(body.transportCost ?? 0))) : new Prisma.Decimal(0);
          const landedUnit = qty.gt(0) ? qty.mul(D(i.unitPrice)).add(extraShare).div(qty) : D(i.unitPrice);
          await tx.materialReceiptItem.create({
            data: { receiptId: receipt.id, materialId: i.materialId, qty, unitCost: landedUnit.toDecimalPlaces(4), lineTotal: qty.mul(landedUnit).toDecimalPlaces(2) },
          });
          await postMaterialMovement(tx, {
            materialId: i.materialId, toWarehouseId: warehouseId, qty, unitCost: landedUnit,
            type: "RECEIPT", refType: "MATERIAL_RECEIPT", refId: receipt.id, refNo: code,
            userId: user.id, userName: user.name, note: "Direct purchase",
          });
          totalValue += N(qty.mul(landedUnit));
        }
        await tx.vendorInvoice.create({
          data: { invoiceNo: `${poCode}-INV`, partnerId: supplierId, poId: po.id, amount: D(totalValue), status: "OPEN", notes: `Direct purchase ${code}` },
        });
        await postReceiptAccounting(tx, {
          materialValue: totalValue, transportCost: 0, loadingCost: 0, unloadingCost: 0,
          otherCost: 0, taxAmount: 0, totalPayable: totalValue, refId: receipt.id, refNo: code, userId: user.id,
        });
        await logActivity(tx, { module: "PROCUREMENT", action: "direct_purchase", description: `Direct purchase ${code} — ৳${Math.round(totalValue).toLocaleString()}`, userName: user.name, refNo: code, amount: totalValue });
        return { receipt, duplicate: false };
      });
      return ok(ser(result));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (resource === "returns") {
    try {
      const result = await db.$transaction(async tx => {
        const request = await claimTransactionRequest(tx, "PURCHASE_RETURN", body, user.id);
        if (request?.resourceId) return tx.purchaseReturn.findUniqueOrThrow({ where: { id: request.resourceId } });
        const poId = String(body.poId ?? "");
        const warehouseId = String(body.warehouseId ?? "");
        const items = body.items as { materialId: string; qty: number }[];
        if (!Array.isArray(items) || !items.length || items.some(item => !item || typeof item.materialId !== "string" ||
            !item.materialId || !Number.isFinite(item.qty) || item.qty <= 0) ||
            new Set(items.map(item => item.materialId)).size !== items.length) {
          throw new Error("Return requires distinct materials and positive quantities");
        }
        await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${poId} FOR UPDATE`;
        const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { supplier: true } });
        if (!po || !["PARTIAL", "RECEIVED"].includes(po.status) || po.supplierId !== String(body.supplierId) ||
            po.currency !== "BDT" || !await canAccessWarehouses(user, [warehouseId])) {
          throw new Error("Return requires a received BDT purchase order, matching supplier and accessible warehouse");
        }
        if (po.taxAmount.gt(0)) throw new Error("A tax-bearing return requires a supplier tax credit workflow");
        const received = await tx.materialReceiptItem.groupBy({
          by: ["materialId"],
          where: { receipt: { poId, warehouseId } },
          _sum: { qty: true },
        });
        const receivedByMaterial = new Map(received.map(row => [row.materialId, D(row._sum.qty)]));
        const previous = await tx.purchaseReturn.findMany({ where: { poId, warehouseId }, select: { itemsJson: true } });
        const returnedByMaterial = new Map<string, Prisma.Decimal>();
        for (const record of previous) {
          for (const row of JSON.parse(record.itemsJson) as { materialId: string; qty: number }[]) {
            returnedByMaterial.set(row.materialId, (returnedByMaterial.get(row.materialId) ?? D(0)).add(row.qty));
          }
        }
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason) throw new Error("Return reason is required");
        const code = await nextDocNo(tx, "PRET");
        const returned = await tx.purchaseReturn.create({
          data: { code, poId, supplierId: po.supplierId, warehouseId, reason, createdById: user.id, itemsJson: "[]" },
        });
        const detailed: { materialId: string; qty: number; unitCost: Prisma.Decimal }[] = [];
        let merchandiseValue = D(0);
        for (const item of items) {
          const returnable = (receivedByMaterial.get(item.materialId) ?? D(0)).sub(returnedByMaterial.get(item.materialId) ?? D(0));
          if (D(item.qty).gt(returnable)) throw new Error("Return exceeds units received for the purchase order");
          const movement = await postMaterialMovement(tx, {
            materialId: item.materialId, fromWarehouseId: warehouseId, qty: item.qty, type: "RETURN_STOCK",
            refType: "PURCHASE_RETURN", refId: returned.id, refNo: code, userId: user.id, userName: user.name, note: reason,
          });
          merchandiseValue = merchandiseValue.add(movement.value);
          detailed.push({ ...item, unitCost: movement.unitCost });
        }
        const total = merchandiseValue.toDecimalPlaces(2);
        if (total.gt(0)) {
          const invoices = await tx.vendorInvoice.findMany({
            where: { poId, partnerId: po.supplierId, status: { in: ["OPEN", "PARTIAL"] } },
            orderBy: [{ date: "asc" }, { id: "asc" }],
          });
          let credit = total;
          for (const invoice of invoices) {
            if (credit.isZero()) break;
            const applied = Prisma.Decimal.min(credit, invoice.amount.sub(invoice.paidAmount));
            if (applied.lte(0)) continue;
            const amount = invoice.amount.sub(applied);
            await tx.vendorInvoice.update({
              where: { id: invoice.id }, data: { amount, status: amount.eq(invoice.paidAmount) ? "PAID" : invoice.status },
            });
            await logAudit(tx, { userId: user.id, userName: user.name, action: "UPDATE", entity: "VendorInvoice", entityId: invoice.id,
              refNo: code, prevJson: { amount: invoice.amount }, newJson: { amount, purchaseReturnId: returned.id } });
            credit = credit.sub(applied);
          }
          if (!credit.isZero()) throw new Error("Return exceeds open vendor payable and requires refund reconciliation");
          await postJournal(tx, {
            memo: `Purchase return ${code}`, refType: "PURCHASE_RETURN", refId: returned.id, refNo: code, userId: user.id,
            lines: [{ accountCode: payableAccountFor(po.supplier.type), debit: total }, { accountCode: ACC.RM_INV, credit: total }],
          });
        }
        const saved = await tx.purchaseReturn.update({
          where: { id: returned.id }, data: { itemsJson: JSON.stringify(ser(detailed)), totalAmount: total, refundStatus: "CREDIT_APPLIED" },
        });
        if (request) await tx.salesRequest.update({ where: { key: request.key }, data: { resourceId: saved.id } });
        await logActivity(tx, { module: "PROCUREMENT", action: "purchase_return", description: `Purchase return ${code} — ৳${total.toFixed(2)}`, userName: user.name, refNo: code, amount: total });
        return saved;
      });
      return ok(ser(result));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (resource === "invoices" && action === "create") {
    return bad("Vendor invoices must originate in an inventory, production or expense workflow", 409);
  }

  if (resource === "payments" && action === "pay") {
    try {
      const result = await db.$transaction(async (tx) => {
        const request = await claimTransactionRequest(tx, "VENDOR_PAYMENT", body, user.id);
        if (request?.resourceId) return tx.payment.findUniqueOrThrow({ where: { id: request.resourceId } });
        const invoiceId = String(body.invoiceId);
        const source = await tx.vendorInvoice.findUnique({ where: { id: invoiceId }, select: { poId: true } });
        if (source?.poId) await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${source.poId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "VendorInvoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
        const invoice = await tx.vendorInvoice.findUnique({ where: { id: invoiceId }, include: { partner: true, po: true } });
        if (!invoice || !["OPEN", "PARTIAL"].includes(invoice.status) || (!invoice.poId && !invoice.workOrderId)) {
          throw new Error("Vendor invoice is not payable through this workflow");
        }
        if (invoice.po?.warehouseId && !await canAccessWarehouses(user, [invoice.po.warehouseId])) throw new Error("Warehouse access denied");
        const outstanding = invoice.amount.sub(invoice.paidAmount);
        const amount = typeof body.amount === "number" ? D(body.amount) : outstanding;
        if (!amount.isFinite() || amount.lte(0) || amount.gt(outstanding) || !amount.eq(amount.toDecimalPlaces(2))) {
          throw new Error(`Payment requires a positive currency amount within the outstanding balance (৳${outstanding.toFixed(2)})`);
        }
        const code = await nextDocNo(tx, "PAY");
        const account = await tx.account.findFirst({
          where: { ...(body.accountId ? { id: String(body.accountId) } : { code: String(body.accountCode ?? "1010") }),
            type: { in: ["CASH", "BANK", "MOBILE_BANKING"] }, isActive: true, currency: "BDT" },
        });
        if (!account) throw new Error("An active BDT payment account is required");
        const payment = await tx.payment.create({
          data: {
            code, date: body.date ? new Date(String(body.date)) : new Date(),
            direction: "OUT", partnerId: invoice.partnerId, vendorInvoiceId: invoice.id,
            accountId: account.id, amount: D(amount), method: String(body.method ?? "CASH"),
            reference: body.reference as string | undefined, notes: body.notes as string | undefined, createdById: user.id,
          },
        });
        const newPaid = D(invoice.paidAmount).add(amount);
        const updated = await tx.vendorInvoice.updateMany({
          where: { id: invoice.id, paidAmount: invoice.paidAmount, status: invoice.status },
          data: { paidAmount: newPaid, status: newPaid.eq(invoice.amount) ? "PAID" : "PARTIAL" },
        });
        if (updated.count !== 1) throw new Error("Invoice changed; retry payment");
        // Journal: paying a payable reduces the payable — NOT a new expense
        await postJournal(tx, {
          memo: `Payment ${code} to ${invoice.partner.name} for ${invoice.invoiceNo}`,
          refType: "PAYMENT", refId: payment.id, refNo: code, userId: user.id,
          lines: [
            { accountCode: payableAccountFor(invoice.partner.type), debit: amount },
            { accountCode: account.code, credit: amount },
          ],
        });
        if (invoice.workOrderId) {
          await tx.workOrder.update({ where: { id: invoice.workOrderId }, data: { paidAmount: { increment: D(amount) } } });
        }
        if (invoice.poId) await tx.purchaseOrder.update({ where: { id: invoice.poId }, data: { paidAmount: { increment: amount } } });
        if (request) await tx.salesRequest.update({ where: { key: request.key }, data: { resourceId: payment.id } });
        await logActivity(tx, { module: "FINANCE", action: "vendor_payment", description: `Paid ৳${amount.toFixed(2)} to ${invoice.partner.name} (${invoice.invoiceNo})`, userName: user.name, refNo: code, amount });
        return payment;
      });
      return ok(ser(result));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  return bad(`Unknown procurement action: ${resource}/${action ?? ""}`, 404);
}
