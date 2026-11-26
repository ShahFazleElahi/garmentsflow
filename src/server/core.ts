import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export type Tx = Prisma.TransactionClient;

// ── Money helpers: all money math in Prisma Decimal ──
export const D = (v: number | string | Prisma.Decimal | null | undefined): Prisma.Decimal =>
  new Prisma.Decimal(v ?? 0);
export const N = (v: number | string | Prisma.Decimal | null | undefined): number =>
  Number(v ?? 0);

/** Deterministic integer allocation: distribute total across parts preserving exact sum (largest remainder). */
export function allocateIntegers(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) {
    const base = Math.floor(total / n);
    const res = Array(n).fill(base);
    let rem = total - base * n;
    for (let i = 0; rem > 0; i = (i + 1) % n, rem--) res[i] += 1;
    return res;
  }
  const raw = weights.map((w) => (total * w) / sumW);
  const floors = raw.map((r) => Math.floor(r));
  let rem = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const res = [...floors];
  for (let k = 0; k < order.length && rem > 0; k++, rem--) res[order[k].i] += 1;
  return res;
}

// ── Document numbering ──
const SEQ_DEFAULTS: Record<string, string> = {
  PLAN: "PRD", PO: "PO", GRN: "GRN", PRET: "PRET", BATCH: "BATCH", WO: "WO",
  WOR: "WOR", INS: "QI", RWO: "RWO", PKG: "PKG", SHP: "SHP", SHR: "SHR",
  EXP: "EXP", PAY: "PAY", VIN: "VIN", SI: "SI", JE: "JE", ADJ: "ADJ",
  TRN: "TRN", CNT: "CNT", DOC: "DOC",
};

export async function nextDocNo(tx: Tx, key: string, when?: Date): Promise<string> {
  const seq = await tx.numberSequence.upsert({ where: { key }, create: { key, prefix: SEQ_DEFAULTS[key] ?? key, nextNumber: 2 }, update: { nextNumber: { increment: 1 } } });
  return formatNo(seq.prefix, seq.nextNumber - 1, when);
}

function formatNo(prefix: string, n: number, when?: Date): string {
  const d = when ?? new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${prefix}-${ym}-${String(n).padStart(4, "0")}`;
}

// ── Audit & activity ──
export async function logAudit(
  tx: Tx,
  data: { userId?: string; userName?: string; action: string; entity: string; entityId?: string; refNo?: string; prevJson?: unknown; newJson?: unknown; reason?: string }
) {
  await tx.auditLog.create({
    data: {
      userId: data.userId, userName: data.userName, action: data.action, entity: data.entity,
      entityId: data.entityId, refNo: data.refNo,
      prevJson: data.prevJson ? JSON.stringify(data.prevJson).slice(0, 6000) : undefined,
      newJson: data.newJson ? JSON.stringify(data.newJson).slice(0, 6000) : undefined,
      reason: data.reason,
    },
  });
}

export async function logActivity(
  tx: Tx,
  data: {
    module: string; action: string; description: string; userName?: string;
    planId?: string; batchId?: string; refType?: string; refId?: string; refNo?: string;
    amount?: number | Prisma.Decimal; date?: Date;
  }
) {
  await tx.activityEvent.create({
    data: {
      module: data.module, action: data.action, description: data.description,
      userName: data.userName, planId: data.planId, batchId: data.batchId,
      refType: data.refType, refId: data.refId, refNo: data.refNo,
      amount: data.amount != null ? D(data.amount) : undefined,
      date: data.date ?? new Date(),
    },
  });
}

// ── Double-entry accounting ──
export const ACC = {
  CAPITAL: "1000", AR: "1200", ADVANCE: "1300", RM_INV: "1400", FG_INV: "1410",
  INPUT_TAX: "1500", AP_SUPPLIER: "2000", AP_FACTORY: "2010", AP_TAILOR: "2020",
  AP_LOGISTICS: "2030", OUTPUT_TAX: "2100", SALES: "4000", COGS: "4100",
  RM_PURCHASE: "5000", SERVICE: "5100", FREIGHT: "5200", CUSTOMS: "5300",
  OPEX: "5400", PACKAGING: "5500", LANDED: "5600", ABNORMAL: "5900",
} as const;

export function payableAccountFor(partnerType: string): string {
  switch (partnerType) {
    case "EMBROIDERY_FACTORY": case "PROCESSING": return ACC.AP_FACTORY;
    case "TAILOR": return ACC.AP_TAILOR;
    case "TRANSPORT": case "COURIER": case "FREIGHT_FORWARDER": return ACC.AP_LOGISTICS;
    default: return ACC.AP_SUPPLIER;
  }
}

/**
 * Post a balanced journal entry. lines: [{accountCode, debit, credit}]
 * Throws when debits !== credits.
 */
export async function postJournal(
  tx: Tx,
  data: {
    date?: Date; memo?: string; refType?: string; refId?: string; refNo?: string; userId?: string;
    lines: { accountCode: string; debit?: number | Prisma.Decimal; credit?: number | Prisma.Decimal; memo?: string }[];
  }
): Promise<string> {
  const lines = data.lines
    .map((l) => ({
      accountCode: l.accountCode,
      debit: D(l.debit).toDecimalPlaces(2),
      credit: D(l.credit).toDecimalPlaces(2),
      memo: l.memo,
    }))
    .filter((l) => !l.debit.isZero() || !l.credit.isZero());
  if (lines.length === 0) return "";
  if (lines.some(l => !l.debit.isFinite() || !l.credit.isFinite() || l.debit.lt(0) || l.credit.lt(0) || (l.debit.gt(0) && l.credit.gt(0)))) throw new Error("Invalid journal amounts");
  const debits = lines.reduce((a, l) => a.add(l.debit), new Prisma.Decimal(0));
  const credits = lines.reduce((a, l) => a.add(l.credit), new Prisma.Decimal(0));
  if (!debits.eq(credits)) {
    throw new Error(`Unbalanced journal entry: debit ${debits} != credit ${credits}`);
  }
  const accounts = await tx.account.findMany({
    where: { code: { in: lines.map((l) => l.accountCode) } },
  });
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const entryNo = await nextDocNo(tx, "JE", data.date);
  const entry = await tx.journalEntry.create({
    data: {
      entryNo, date: data.date ?? new Date(), memo: data.memo, refType: data.refType,
      refId: data.refId, refNo: data.refNo, postedById: data.userId,
      lines: {
        create: lines.map((l) => {
          const acc = byCode.get(l.accountCode);
          if (!acc) throw new Error(`Account ${l.accountCode} not found`);
          return { accountId: acc.id, debit: l.debit, credit: l.credit, memo: l.memo };
        }),
      },
    },
  });
  for (const l of lines) {
    const acc = byCode.get(l.accountCode)!;
    const delta = l.debit.minus(l.credit);
    await tx.account.update({ where: { id: acc.id }, data: { balance: { increment: delta } } });
  }
  return entry.id;
}

/** Reverse a posted journal entry with a contra entry. */
export async function reverseJournal(tx: Tx, entryId: string, userId: string, reason: string) {
  const entry = await tx.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: { include: { account: true } } },
  });
  if (!entry) throw new Error("Journal entry not found");
  if (entry.reversedAt || entry.reversalOfId) throw new Error("Entry already reversed or is a reversal");
  const claimed = await tx.journalEntry.updateMany({ where: { id: entryId, reversedAt: null }, data: { reversedAt: new Date() } });
  if (claimed.count !== 1) throw new Error("Entry already reversed");
  const reversalId = await postJournal(tx, {
    date: new Date(),
    memo: `Reversal of ${entry.entryNo}: ${reason}`,
    refType: entry.refType ?? undefined, refId: entry.refId ?? undefined,
    refNo: entry.refNo ?? undefined, userId,
    lines: entry.lines.map((l) => ({
      accountCode: l.account.code, debit: N(l.credit), credit: N(l.debit),
      memo: `Reversal: ${l.memo ?? ""}`,
    })),
  });
  await tx.journalEntry.update({
    where: { id: reversalId },
    data: { reversalOfId: entryId },
  });
}

/** Post a cash/bank payment (money leaving or entering an account). */
export async function postCashMovement(
  tx: Tx,
  data: { accountCode: string; amount: number | Prisma.Decimal; direction: "IN" | "OUT" }
) {
  const acc = await tx.account.findUnique({ where: { code: data.accountCode } });
  if (!acc) throw new Error(`Payment account ${data.accountCode} not found`);
  const amt = D(data.amount);
  const delta = data.direction === "IN" ? amt : amt.neg();
  await tx.account.update({ where: { id: acc.id }, data: { balance: { increment: delta } } });
}
