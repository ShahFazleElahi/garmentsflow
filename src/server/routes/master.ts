import { db } from "@/lib/db";
import { bad, ok, q, ser, requirePerm } from "./helpers";
import { NextRequest } from "next/server";
import { D } from "../core";
import { filterPartnerFinancial, can } from "../auth";

export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;
  const { user } = auth;

  switch (resource) {
    case "locations": {
      const rows = await db.location.findMany({
        include: { warehouses: true, partner: { select: { id: true, name: true, code: true } } },
        orderBy: { code: "asc" },
      });
      return ok(ser(rows));
    }
    case "warehouses": {
      const rows = await db.warehouse.findMany({
        include: { location: true },
        orderBy: { code: "asc" },
      });
      return ok(ser(rows));
    }
    case "partners": {
      const type = q(req, "type");
      const rows = await db.businessPartner.findMany({
        where: type ? { type } : undefined,
        orderBy: { name: "asc" },
      });
      // outstanding balance per partner
      const invoices = await db.vendorInvoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } } });
      const sales = await db.salesInvoice.findMany({ where: { status: { in: ["CONFIRMED", "PARTIAL"] } } });
      const data = rows.map((p) => {
        const payable = invoices.filter((i) => i.partnerId === p.id).reduce((a, i) => a + Number(i.amount) - Number(i.paidAmount), 0);
        const receivable = sales.filter((s) => s.customerId === p.id).reduce((a, s) => a + Number(s.total) - Number(s.paidAmount), 0);
        return { ...filterPartnerFinancial(p as unknown as Record<string, unknown>, user), ...(can(user, "view_financial") ? { payable, receivable } : {}) };
      });
      return ok(ser(data));
    }
    case "materials": {
      const rows = await db.material.findMany({
        include: {
          category: true, stocks: { include: { warehouse: true } },
        },
        orderBy: { name: "asc" },
      });
      return ok(ser(rows));
    }
    case "material-categories":
      return ok(ser(await db.materialCategory.findMany({ orderBy: { name: "asc" } })));
    case "product-categories":
      return ok(ser(await db.productCategory.findMany({ orderBy: { name: "asc" } })));
    case "collections":
      return ok(ser(await db.collection.findMany({ orderBy: { name: "asc" } })));
    case "stages":
      return ok(ser(await db.productionStage.findMany({ orderBy: { seq: "asc" } })));
    case "accounts": {
      const accounts = await db.account.findMany({ orderBy: { code: "asc" } });
      return ok(ser(can(user, "view_financial") ? accounts : accounts.map(({balance, ...a}) => a)));
    }
    case "exchange-rates": {
      const rates = await db.exchangeRate.findMany({ orderBy: { date: "desc" }, take: 50 });
      const latest: Record<string, number> = {};
      for (const r of rates) if (latest[`${r.base}_${r.quote}`] == null) latest[`${r.base}_${r.quote}`] = Number(r.rate);
      return ok({ rows: ser(rates), latest });
    }
    case "suppliers-for-material": {
      const rows = await db.businessPartner.findMany({ where: { type: "SUPPLIER" }, orderBy: { name: "asc" } });
      return ok(ser(rows.map(r => filterPartnerFinancial(r as unknown as Record<string, unknown>, user))));
    }
    case "settings": {
      const rows = await db.systemSetting.findMany();
      const out: Record<string, unknown> = {};
      for (const r of rows) out[r.key] = JSON.parse(r.valueJson);
      return ok(out);
    }
    default:
      return bad(`Unknown master resource: ${resource}`, 404);
  }
}

export async function handlePost(segments: string[], body: Record<string, unknown>, req: NextRequest) {
  const [resource, action] = segments;
  const auth = await requirePerm(req, "edit");
  if ("error" in auth) return auth.error;
  const { user } = auth;
  if (["locations", "warehouses"].includes(resource) && !can(user, "manage_locations")) return bad("Permission denied: manage_locations", 403);
  if (["accounts", "exchange-rates"].includes(resource) && !can(user, "view_financial")) return bad("Permission denied: view_financial", 403);
  if (resource === "settings" && user.roleKey !== "OWNER") return bad("Owner access required", 403);

  switch (resource) {
    case "locations": {
      if (action === "create") {
        const row = await db.location.create({
          data: {
            code: String(body.code), name: String(body.name), country: String(body.country ?? "Bangladesh"),
            division: body.division as string | undefined, district: body.district as string | undefined,
            timezone: String(body.timezone ?? "Asia/Dhaka"), type: String(body.type ?? "BUSINESS"),
          },
        });
        return ok(ser(row));
      }
      if (action === "update") {
        const row = await db.location.update({ where: { id: String(body.id) }, data: body as never });
        return ok(ser(row));
      }
      break;
    }
    case "warehouses": {
      if (action === "create") {
        const row = await db.warehouse.create({
          data: {
            code: String(body.code), name: String(body.name), locationId: String(body.locationId),
            type: String(body.type ?? "MAIN"),
          },
        });
        return ok(ser(row));
      }
      if (action === "update") {
        const row = await db.warehouse.update({ where: { id: String(body.id) }, data: body as never });
        return ok(ser(row));
      }
      break;
    }
    case "partners": {
      if (action === "create") {
        const count = await db.businessPartner.count();
        const row = await db.businessPartner.create({
          data: {
            code: String(body.code ?? `BP-${String(count + 1).padStart(4, "0")}`),
            name: String(body.name), ownerName: body.ownerName as string | undefined,
            contactPerson: body.contactPerson as string | undefined,
            type: String(body.type), servicesJson: JSON.stringify(body.services ?? []),
            phone: body.phone as string | undefined, altPhone: body.altPhone as string | undefined,
            whatsapp: body.whatsapp as string | undefined, email: body.email as string | undefined,
            website: body.website as string | undefined, country: String(body.country ?? "Bangladesh"),
            division: body.division as string | undefined, district: body.district as string | undefined,
            area: body.area as string | undefined, marketName: body.marketName as string | undefined,
            shopNo: body.shopNo as string | undefined, address: body.address as string | undefined,
            mapsUrl: body.mapsUrl as string | undefined, taxId: body.taxId as string | undefined,
            paymentTerms: body.paymentTerms as string | undefined,
            openingBalance: D(body.openingBalance as number), bankInfo: body.bankInfo as string | undefined,
            rating: Number(body.rating ?? 0), notes: body.notes as string | undefined,
            createdById: user.id,
          },
        });
        return ok(ser(row));
      }
      if (action === "update") {
        const { id, services, openingBalance, ...rest } = body as Record<string, unknown> & { id: string };
        const row = await db.businessPartner.update({
          where: { id },
          data: {
            ...rest,
            ...(services ? { servicesJson: JSON.stringify(services) } : {}),
            ...(openingBalance != null ? { openingBalance: D(openingBalance as number) } : {}),
          } as never,
        });
        return ok(ser(row));
      }
      if (action === "deactivate" || action === "activate") {
        const row = await db.businessPartner.update({
          where: { id: String(body.id) }, data: { isActive: action === "activate" },
        });
        return ok(ser(row));
      }
      break;
    }
    case "materials": {
      if (action === "create") {
        const row = await db.material.create({
          data: {
            sku: String(body.sku), name: String(body.name), categoryId: (body.categoryId as string) || null,
            description: body.description as string | undefined, composition: body.composition as string | undefined,
            width: body.width as string | undefined, gsm: body.gsm as string | undefined,
            colorName: body.colorName as string | undefined, shade: body.shade as string | undefined,
            dyeLot: body.dyeLot as string | undefined,
            preferredSupplierId: (body.preferredSupplierId as string) || null,
            purchaseUnit: String(body.purchaseUnit ?? "Yard"), baseUnit: String(body.baseUnit ?? "Yard"),
            conversionNote: body.conversionNote as string | undefined,
            purchasePrice: D(body.purchasePrice as number), avgCost: D(body.purchasePrice as number),
            minStock: D(body.minStock as number ?? 0), reorderLevel: D(body.reorderLevel as number ?? 0),
          },
        });
        return ok(ser(row));
      }
      if (action === "update") {
        const { id, ...rest } = body as Record<string, unknown> & { id: string };
        const patch: Record<string, unknown> = { ...rest };
        for (const k of ["purchasePrice", "minStock", "reorderLevel"]) {
          if (rest[k] != null) patch[k] = D(rest[k] as number);
        }
        if (rest.avgCost != null) patch.avgCost = D(rest.avgCost as number);
        const row = await db.material.update({ where: { id }, data: patch as never });
        return ok(ser(row));
      }
      break;
    }
    case "product-categories": {
      const row = await db.productCategory.create({
        data: { name: String(body.name), code: String(body.code), description: body.description as string | undefined },
      });
      return ok(ser(row));
    }
    case "collections": {
      const row = await db.collection.create({
        data: {
          name: String(body.name), season: body.season as string | undefined,
          launchDate: body.launchDate ? new Date(String(body.launchDate)) : undefined,
          notes: body.notes as string | undefined,
        },
      });
      return ok(ser(row));
    }
    case "stages": {
      if (action === "create") {
        const row = await db.productionStage.create({
          data: {
            key: String(body.key ?? String(body.name).toUpperCase().replaceAll(" ", "_")),
            name: String(body.name), seq: Number(body.seq ?? 99), isDefault: false,
          },
        });
        return ok(ser(row));
      }
      if (action === "update") {
        const row = await db.productionStage.update({
          where: { id: String(body.id) }, data: { name: body.name as string | undefined, seq: body.seq as number | undefined, active: body.active as boolean | undefined },
        });
        return ok(ser(row));
      }
      break;
    }
    case "accounts": {
      if (action === "create") {
        const row = await db.account.create({
          data: { code: String(body.code), name: String(body.name), type: String(body.type), currency: String(body.currency ?? "BDT") },
        });
        return ok(ser(row));
      }
      break;
    }
    case "exchange-rates": {
      const date = new Date(String(body.date ?? new Date().toISOString().slice(0, 10)));
      const row = await db.exchangeRate.upsert({
        where: { date_base_quote: { date, base: String(body.base), quote: String(body.quote) } },
        update: { rate: D(body.rate as number) },
        create: { date, base: String(body.base), quote: String(body.quote), rate: D(body.rate as number) },
      });
      return ok(ser(row));
    }
    case "settings": {
      const entries = body as Record<string, unknown>;
      for (const [key, value] of Object.entries(entries)) {
        await db.systemSetting.upsert({
          where: { key },
          update: { valueJson: JSON.stringify(value) },
          create: { key, valueJson: JSON.stringify(value) },
        });
      }
      return ok({ saved: true });
    }
  }
  return bad(`Unknown action: ${resource}/${action ?? ""}`, 404);
}
