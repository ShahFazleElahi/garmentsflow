import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, nextDocNo, logAudit, logActivity, postJournal, ACC, payableAccountFor } from "../core";
import { postMaterialMovement, postReceiptAccounting } from "../inventory";
import { Prisma } from "@prisma/client";

// ───────────────────────── GET ─────────────────────────
export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, ["invoices", "payments"].includes(resource) ? "view_financial" : "view");
  if ("error" in auth) return auth.error;

  if (resource === "orders" && !id) {
    const rows = await db.purchaseOrder.findMany({
      include: { supplier: true, plan: { select: { code: true, name: true } }, items: { include: { material: true } }, receipts: true },
      orderBy: { orderDate: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "orders" && id) {
    const row = await db.purchaseOrder.findUnique({
      where: { id },
      include: { supplier: true, plan: true, items: { include: { material: true } }, receipts: { include: { items: true } } },
    });
    if (!row) return bad("Purchase order not found", 404);
    return ok(ser(row));
  }
  if (resource === "receipts") {
    const rows = await db.materialReceipt.findMany({
      include: { items: { include: { material: true } }, po: { include: { supplier: true } } },
      orderBy: { receiptDate: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "returns") {
    const rows = await db.purchaseReturn.findMany({ orderBy: { returnDate: "desc" } });
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
      include: { material: { include: { category: true } }, plan: true },
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
            const code = await nextDocNo(tx, "PO");
            const items = (body.items ?? []) as { materialId: string; qty: number; unitPrice: number; unit?: string; colorName?: string; shade?: string }[];
            if (!items.length || items.some(i => !Number.isFinite(i.qty) || i.qty <= 0 || !Number.isFinite(i.unitPrice) || i.unitPrice < 0)) throw new Error("Valid material quantities and prices required");
            const supplier = await tx.businessPartner.findUnique({ where: { id: String(body.supplierId) } });
            if (!supplier) throw new Error("Supplier not found");
            const subtotal = items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
            const discount = Number(body.discountAmount ?? 0);
            const tax = Number(body.taxAmount ?? 0);
            const transport = Number(body.transportCost ?? 0);
            const loading = Number(body.loadingCost ?? 0);
            const unloading = Number(body.unloadingCost ?? 0);
            const other = Number(body.otherCost ?? 0);
            const total = subtotal - discount + tax + transport + loading + unloading + other;
            const po = await tx.purchaseOrder.create({
              data: {
                code, supplierId: supplier.id, planId: (body.planId as string) || null,
                type: String(body.type ?? "PO"), status: "ORDERED",
                orderDate: body.orderDate ? new Date(String(body.orderDate)) : new Date(),
                expectedDate: body.expectedDate ? new Date(String(body.expectedDate)) : undefined,
                locationId: (body.locationId as string) || null, warehouseId: (body.warehouseId as string) || null,
                subtotal: D(subtotal), discountAmount: D(discount), taxAmount: D(tax),
                transportCost: D(transport), loadingCost: D(loading), unloadingCost: D(unloading), otherCost: D(other),
                total: D(total), currency: String(body.currency ?? "BDT"),
                exchangeRate: D(Number(body.exchangeRate ?? 1)),
                dueDate: body.dueDate ? new Date(String(body.dueDate)) : undefined,
                notes: body.notes as string | undefined, createdById: user.id,
                items: {
                  create: items.map((i) => ({
                    materialId: i.materialId, qty: D(i.qty), unit: i.unit ?? "Yard",
                    unitPrice: D(i.unitPrice), lineTotal: D(i.qty * i.unitPrice),
                    colorName: i.colorName, shade: i.shade,
                  })),
                },
              },
              include: { items: true },
            });
            // advance payment handling
            const advance = Number(body.advanceAmount ?? 0);
            if (advance > 0) {
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
                  accountId: String(body.accountId), amount: D(advance), method: String(body.paymentMethod ?? "CASH"),
                  notes: `Advance for ${po.code}`, createdById: user.id,
                },
              });
              await postJournal(tx, {
                memo: `Advance payment for ${po.code}`, refType: "PURCHASE_ORDER", refId: po.id, refNo: po.code, userId: user.id,
                lines: [
                  { accountCode: ACC.ADVANCE, debit: advance },
                  { accountCode: String(body.accountCode ?? "1010"), credit: advance },
                ],
              });
              await tx.purchaseOrder.update({ where: { id: po.id }, data: { advanceAmount: D(advance), paidAmount: D(advance) } });
            }
            await logAudit(tx, { userId: user.id, userName: user.name, action: "CREATE", entity: "PurchaseOrder", entityId: po.id, refNo: po.code, newJson: { total } });
            await logActivity(tx, { module: "PROCUREMENT", action: "po_created", description: `Purchase order ${po.code} — ${supplier.name}, ${items.length} material line(s), ৳${total.toLocaleString()}`, userName: user.name, planId: (body.planId as string) || undefined, refNo: po.code, amount: total });
            return po;
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "cancel": {
        const po = await db.purchaseOrder.update({ where: { id: String(body.id) }, data: { status: "CANCELLED" } });
        await db.$transaction((tx) => logActivity(tx, { module: "PROCUREMENT", action: "po_cancelled", description: `Purchase order ${po.code} cancelled`, userName: user.name, refNo: po.code }));
        return ok(ser(po));
      }
      case "receive": {
        try {
          const result = await db.$transaction(async (tx) => {
            const idem = body.idempotencyKey as string | undefined;
            if (idem) {
              const dupe = await tx.materialReceipt.findUnique({ where: { idempotencyKey: idem } });
              if (dupe) return { receipt: dupe, duplicate: true };
            }
            const po = await tx.purchaseOrder.findUnique({
              where: { id: String(body.poId) },
              include: { items: true, supplier: true },
            });
            if (!po) throw new Error("Purchase order not found");
            if (po.status === "CANCELLED") throw new Error("Cannot receive against a cancelled order");

            const lines = (body.items ?? []) as { poItemId?: string; materialId: string; qty: number; unitPrice?: number }[];
            if (!lines.length) throw new Error("No receiving lines provided");
            const warehouseId = String(body.warehouseId ?? po.warehouseId);
            if (!warehouseId) throw new Error("Destination warehouse required");

            const transport = Number(body.transportCost ?? 0);
            const loading = Number(body.loadingCost ?? 0);
            const unloading = Number(body.unloadingCost ?? 0);
            const other = Number(body.otherCost ?? 0);
            const receivingExtras = transport + loading + unloading + other;
            const lineValue = lines.reduce((a, l) => a + l.qty * (l.unitPrice ?? N(po.items.find((p) => p.id === l.poItemId)?.unitPrice ?? 0)), 0);

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

            let totalValue = 0;
            for (const line of lines) {
              const poItem = po.items.find((p) => p.id === line.poItemId);
              const unitPrice = D(line.unitPrice ?? N(poItem?.unitPrice ?? 0));
              const qty = D(line.qty);
              // allocate extras proportionally by line value
              const share = lineValue > 0 ? qty.mul(unitPrice).div(lineValue) : new Prisma.Decimal(0);
              const extraForLine = share.mul(receivingExtras);
              const landedUnit = qty.gt(0) ? qty.mul(unitPrice).add(extraForLine).div(qty) : unitPrice;
              await tx.materialReceiptItem.create({
                data: {
                  receiptId: receipt.id, poItemId: line.poItemId || null, materialId: line.materialId,
                  qty, unit: poItem?.unit ?? "Yard", unitCost: landedUnit.toDecimalPlaces(4),
                  lineTotal: qty.mul(landedUnit).toDecimalPlaces(2),
                },
              });
              if (poItem) {
                const newReceived = D(poItem.receivedQty).add(qty);
                if (newReceived.gt(D(poItem.qty))) throw new Error(`Over-receiving prevented: ${poItem.materialId} would exceed ordered quantity`);
                await tx.purchaseOrderItem.update({ where: { id: poItem.id }, data: { receivedQty: newReceived } });
              }
              await postMaterialMovement(tx, {
                materialId: line.materialId, toWarehouseId: warehouseId, qty,
                unitCost: landedUnit, type: "RECEIPT", refType: "MATERIAL_RECEIPT",
                refId: receipt.id, refNo: code, userId: user.id, userName: user.name,
                note: `Received against ${po.code}`,
              });
              totalValue += N(qty.mul(landedUnit));
            }

            // supplier invoice for the received value
            const invoiceAmount = totalValue;
            await tx.vendorInvoice.create({
              data: {
                invoiceNo: body.supplierInvoiceNo as string || `${po.code}-INV`,
                partnerId: po.supplierId, poId: po.id, date: new Date(),
                amount: D(invoiceAmount), status: "OPEN",
                notes: `Goods received ${code}`,
              },
            });

            await postReceiptAccounting(tx, {
              materialValue: totalValue,
              transportCost: 0, loadingCost: 0, unloadingCost: 0, otherCost: 0, // already in landed units
              taxAmount: 0, totalPayable: invoiceAmount,
              refId: receipt.id, refNo: code, userId: user.id,
            });

            // PO status
            const refreshed = await tx.purchaseOrder.findUnique({ where: { id: po.id }, include: { items: true } });
            const fully = refreshed!.items.every((i) => D(i.receivedQty).gte(D(i.qty)));
            await tx.purchaseOrder.update({
              where: { id: po.id },
              data: { status: fully ? "RECEIVED" : "PARTIAL", supplierInvoiceNo: (body.supplierInvoiceNo as string) ?? po.supplierInvoiceNo },
            });

            await logActivity(tx, {
              module: "PROCUREMENT", action: "materials_received",
              description: `Materials received ${code} against ${po.code} — ${lines.length} line(s), value ৳${Math.round(totalValue).toLocaleString()}`,
              userName: user.name, refNo: code, amount: totalValue, planId: po.planId ?? undefined,
            });
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
      const result = await db.$transaction(async (tx) => {
        const code = await nextDocNo(tx, "PRET");
        const items = (body.items ?? []) as { materialId: string; qty: number; unitCost?: number }[];
        const warehouseId = String(body.warehouseId);
        let total = 0;
        const ret = await tx.purchaseReturn.create({
          data: { code, poId: (body.poId as string) || null, supplierId: String(body.supplierId), warehouseId, reason: body.reason as string | undefined, createdById: user.id, itemsJson: "[]" },
        });
        const detailed: { materialId: string; qty: number; unitCost: number }[] = [];
        for (const i of items) {
          await postMaterialMovement(tx, {
            materialId: i.materialId, fromWarehouseId: warehouseId, qty: i.qty,
            type: "RETURN_STOCK", refType: "PURCHASE_RETURN", refId: ret.id, refNo: code,
            userId: user.id, userName: user.name, note: `Purchase return to supplier: ${body.reason ?? ""}`,
          });
          const stock = await tx.materialStock.findFirst({ where: { materialId: i.materialId, warehouseId } });
          const unitCost = Number(i.unitCost ?? N(stock?.avgCost ?? 0));
          total += unitCost * i.qty;
          detailed.push({ materialId: i.materialId, qty: i.qty, unitCost });
        }
        await tx.purchaseReturn.update({ where: { id: ret.id }, data: { itemsJson: JSON.stringify(detailed), totalAmount: D(total), refundStatus: String(body.refundStatus ?? "PENDING") } });
        // reduce payable via credit note
        if (total > 0) {
          await postJournal(tx, {
            memo: `Purchase return ${code}`, refType: "PURCHASE_RETURN", refId: ret.id, refNo: code, userId: user.id,
            lines: [
              { accountCode: ACC.AP_SUPPLIER, debit: total },
              { accountCode: ACC.RM_INV, credit: total },
            ],
          });
        }
        await logActivity(tx, { module: "PROCUREMENT", action: "purchase_return", description: `Purchase return ${code} — ৳${Math.round(total).toLocaleString()}`, userName: user.name, refNo: code, amount: total });
        return ret;
      });
      return ok(ser(result));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (resource === "invoices" && action === "create") {
    const inv = await db.vendorInvoice.create({
      data: {
        invoiceNo: String(body.invoiceNo), partnerId: String(body.partnerId),
        workOrderId: (body.workOrderId as string) || null,
        date: body.date ? new Date(String(body.date)) : new Date(),
        dueDate: body.dueDate ? new Date(String(body.dueDate)) : undefined,
        amount: D(body.amount as number), notes: body.notes as string | undefined,
      },
    });
    return ok(ser(inv));
  }

  if (resource === "payments" && action === "pay") {
    try {
      const result = await db.$transaction(async (tx) => {
        const invoice = await tx.vendorInvoice.findUnique({ where: { id: String(body.invoiceId) }, include: { partner: true } });
        if (!invoice || invoice.status === "CANCELLED") throw new Error("Vendor invoice not found or cancelled");
        const amount = Number(body.amount ?? Number(invoice.amount) - Number(invoice.paidAmount));
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid payment amount");
        const outstanding = Number(invoice.amount) - Number(invoice.paidAmount);
        if (amount > outstanding + 0.01) throw new Error(`Payment exceeds outstanding balance (৳${outstanding.toFixed(2)})`);
        const code = await nextDocNo(tx, "PAY");
        const account = await tx.account.findFirstOrThrow({ where: { ...(body.accountId ? { id: String(body.accountId) } : { code: String(body.accountCode ?? "1010") }), type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } } });
        const payment = await tx.payment.create({
          data: {
            code, date: body.date ? new Date(String(body.date)) : new Date(),
            direction: "OUT", partnerId: invoice.partnerId, vendorInvoiceId: invoice.id,
            accountId: account.id, amount: D(amount), method: String(body.method ?? "CASH"),
            reference: body.reference as string | undefined, notes: body.notes as string | undefined, createdById: user.id,
          },
        });
        const newPaid = Number(invoice.paidAmount) + amount;
        const updated = await tx.vendorInvoice.updateMany({
          where: { id: invoice.id, paidAmount: invoice.paidAmount, status: invoice.status },
          data: { paidAmount: D(newPaid), status: newPaid >= Number(invoice.amount) - 0.01 ? "PAID" : "PARTIAL" },
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
        await logActivity(tx, { module: "FINANCE", action: "vendor_payment", description: `Paid ৳${amount.toLocaleString()} to ${invoice.partner.name} (${invoice.invoiceNo})`, userName: user.name, refNo: code, amount });
        return payment;
      });
      return ok(ser(result));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  return bad(`Unknown procurement action: ${resource}/${action ?? ""}`, 404);
}
