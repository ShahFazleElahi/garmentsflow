// Shared constants: statuses, categories, permissions — used by server and client.

export const PLAN_STATUSES = [
  "DRAFT", "CONCEPT_DEVELOPMENT", "DESIGN_DEVELOPMENT", "SAMPLE_DEVELOPMENT", "SAMPLE_APPROVED",
  "VARIANT_CONFIGURATION", "MATERIAL_PLANNING", "BUDGET_PLANNING", "AWAITING_APPROVAL", "APPROVED",
  "PROCUREMENT_IN_PROGRESS", "READY_FOR_PRODUCTION", "IN_PRODUCTION", "PARTIALLY_COMPLETED",
  "COMPLETED", "ON_HOLD", "CANCELLED",
] as const;

export const WO_STATUSES = [
  "DRAFT", "MATERIALS_PREPARED", "DISPATCHED", "RECEIVED_BY_FACTORY", "IN_PROGRESS",
  "PARTIALLY_COMPLETED", "READY_FOR_COLLECTION", "PARTIALLY_COLLECTED", "AWAITING_QC",
  "REWORK_REQUIRED", "COMPLETED", "CANCELLED",
] as const;

export const SHIPMENT_STATUSES = [
  "DRAFT", "READY", "DISPATCHED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "DELIVERED",
  "RECEIVED_VERIFIED", "DELAYED", "EXCEPTION", "RETURNED", "CANCELLED",
] as const;

export const EXPENSE_CATEGORIES = [
  "Raw Material Purchase", "Sample Development", "Embroidery", "Tailoring", "Cutting",
  "Printing", "Washing", "Finishing", "Packaging", "Transportation", "Courier",
  "International Freight", "Customs", "Loading and Unloading", "Rent", "Office Expenses",
  "Employee Expenses", "Travel", "Meals", "Marketing", "Miscellaneous",
] as const;

export const MATERIAL_CATEGORIES = [
  "Fabric", "Lace", "Tassels", "Stones", "Thread", "Buttons", "Zippers", "Beads",
  "Sequins", "Lining", "Interlining", "Elastic", "Brand Labels", "Size Labels",
  "Hang Tags", "Poly Bags", "Cartons", "Other Accessories",
] as const;

export const PRODUCT_CATEGORIES_SEED = [
  "Women's Three-Piece", "Women's Two-Piece", "Kurti", "Kameez", "Abaya", "Dress",
  "Salwar", "Dupatta", "Tops", "Trousers",
] as const;

export const COLLECTIONS_SEED = [
  "Eid Collection", "Ramadan Collection", "Summer Collection", "Winter Collection",
  "Bridal Collection", "Premium Collection",
] as const;

export const UNITS = [
  "Yard", "Meter", "Kilogram", "Gram", "Cone", "Spool", "Roll", "Piece",
  "Packet", "Dozen", "Bundle", "Box",
] as const;

export const GARMENT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "Free Size"] as const;

export const WORK_ORDER_TYPES = [
  "EMBROIDERY", "TAILORING", "CUTTING", "PRINTING", "WASHING", "FINISHING", "OTHER",
] as const;

export const STAGES_SEED = [
  { key: "MATERIAL_PREPARATION", name: "Material Preparation", seq: 10, isDefault: true },
  { key: "EMBROIDERY", name: "Embroidery", seq: 20, isDefault: true },
  { key: "CUTTING", name: "Cutting", seq: 30, isDefault: true },
  { key: "TAILORING", name: "Tailoring", seq: 40, isDefault: true },
  { key: "FINISHING", name: "Finishing", seq: 50, isDefault: true },
  { key: "FINAL_QC", name: "Final Quality Control", seq: 60, isDefault: true },
  { key: "FINISHED_GOODS", name: "Finished Goods", seq: 70, isDefault: true },
  { key: "DIGITAL_PRINTING", name: "Digital Printing", seq: 25, isDefault: false },
  { key: "DYEING", name: "Dyeing", seq: 26, isDefault: false },
  { key: "WASHING", name: "Washing", seq: 27, isDefault: false },
  { key: "STONE_APPLICATION", name: "Stone Application", seq: 28, isDefault: false },
  { key: "LACE_ATTACHMENT", name: "Lace Attachment", seq: 29, isDefault: false },
  { key: "LABEL_ATTACHMENT", name: "Label Attachment", seq: 55, isDefault: false },
  { key: "IRONING", name: "Ironing", seq: 56, isDefault: false },
];

export const PAYMENT_METHODS = ["CASH", "BANK", "BKASH", "NAGAD", "ROCKET", "CARD", "INTL_TRANSFER", "OTHER"] as const;

export const ACCOUNTS_SEED = [
  { code: "1000", name: "Business Capital", type: "EQUITY" },
  { code: "1010", name: "Cash in Hand — Dhaka", type: "CASH" },
  { code: "1011", name: "Cash in Hand — Sylhet", type: "CASH" },
  { code: "1020", name: "Bank — City Bank Dhaka", type: "BANK" },
  { code: "1021", name: "Bank — UK Account (GBP)", type: "BANK", currency: "GBP" },
  { code: "1030", name: "bKash Merchant", type: "MOBILE_BANKING" },
  { code: "1040", name: "Nagad Merchant", type: "MOBILE_BANKING" },
  { code: "1200", name: "Accounts Receivable", type: "RECEIVABLE" },
  { code: "1300", name: "Vendor Advances", type: "ADVANCE" },
  { code: "1400", name: "Raw Material Inventory", type: "INVENTORY" },
  { code: "1410", name: "Finished Goods Inventory", type: "INVENTORY" },
  { code: "1420", name: "Work In Progress Inventory", type: "INVENTORY" },
  { code: "1500", name: "Input Tax (Recoverable)", type: "TAX" },
  { code: "2000", name: "Accounts Payable — Suppliers", type: "PAYABLE" },
  { code: "2010", name: "Accounts Payable — Factories", type: "PAYABLE" },
  { code: "2020", name: "Accounts Payable — Tailors", type: "PAYABLE" },
  { code: "2030", name: "Accounts Payable — Logistics", type: "PAYABLE" },
  { code: "2100", name: "Output Tax Payable", type: "TAX" },
  { code: "4000", name: "Sales Revenue", type: "INCOME" },
  { code: "4100", name: "Cost of Goods Sold", type: "EXPENSE" },
  { code: "5000", name: "Raw Material Purchases", type: "EXPENSE" },
  { code: "5100", name: "Production Service Charges", type: "EXPENSE" },
  { code: "5200", name: "Freight & Transportation", type: "EXPENSE" },
  { code: "5300", name: "Customs & Duties", type: "EXPENSE" },
  { code: "5400", name: "Operating Expenses", type: "EXPENSE" },
  { code: "5500", name: "Packaging Expenses", type: "EXPENSE" },
  { code: "5600", name: "Landed Cost Adjustment", type: "EXPENSE" },
  { code: "5900", name: "Abnormal Loss / Wastage", type: "EXPENSE" },
];

// ── Permissions ──
export const PERMISSIONS = [
  "view", "create", "edit", "approve", "post", "cancel", "reverse", "export",
  "manage_users", "view_financial", "manage_locations",
  "module_planning", "module_procurement", "module_inventory", "module_production",
  "module_quality", "module_packaging", "module_logistics", "module_finance", "module_sales",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const DEFAULT_ROLES: { key: string; name: string; permissions: string[] }[] = [
  { key: "OWNER", name: "Owner / Super Admin", permissions: [...PERMISSIONS] },
  { key: "OPS_MANAGER", name: "Operations Manager", permissions: ["view", "create", "edit", "approve", "post", "cancel", "export", "view_financial", "manage_locations"] },
  { key: "PLANNING_MGR", name: "Product Planning Manager", permissions: ["view", "create", "edit", "approve", "export"] },
  { key: "DESIGN_MGR", name: "Design Manager", permissions: ["view", "create", "edit", "export"] },
  { key: "PROCUREMENT_MGR", name: "Procurement Manager", permissions: ["view", "create", "edit", "approve", "post", "export", "view_financial"] },
  { key: "PRODUCTION_MGR", name: "Production Manager", permissions: ["view", "create", "edit", "post", "export"] },
  { key: "QC_OFFICER", name: "Quality Control Officer", permissions: ["view", "create", "edit", "post", "export"] },
  { key: "DHAKA_WH_MGR", name: "Dhaka Warehouse Manager", permissions: ["view", "create", "edit", "post", "export"] },
  { key: "SYLHET_WH_MGR", name: "Sylhet Warehouse Manager", permissions: ["view", "create", "edit", "post", "export"] },
  { key: "UK_WH_MGR", name: "UK Warehouse Manager", permissions: ["view", "create", "edit", "post", "export"] },
  { key: "LOGISTICS_MGR", name: "Logistics Manager", permissions: ["view", "create", "edit", "post", "export"] },
  { key: "ACCOUNTANT", name: "Accountant", permissions: ["view", "create", "edit", "post", "reverse", "export", "view_financial"] },
  { key: "SALES_MGR", name: "Sales Manager", permissions: ["view", "create", "edit", "post", "export", "view_financial"] },
  { key: "DATA_ENTRY", name: "Data Entry Operator", permissions: ["view", "create", "edit"] },
  { key: "AUDITOR", name: "Auditor", permissions: ["view", "export", "view_financial"] },
  { key: "READ_ONLY", name: "Read-Only User", permissions: ["view"] },
];

export function roleHasPermission(roleKey: string, perm: Permission, customRoles: { key: string; permissionsJson: string }[]): boolean {
  if (roleKey === "OWNER") return true;
  const role = customRoles.find((r) => r.key === roleKey);
  if (!role) return false;
  try {
    const perms = JSON.parse(role.permissionsJson) as string[];
    return perms.includes(perm);
  } catch {
    return false;
  }
}

// ── Account type helpers for journal posting ──
export const CASH_LIKE = ["CASH", "BANK", "MOBILE_BANKING"];

export const CURRENCIES = ["BDT", "GBP", "USD"] as const;
export const BASE_CURRENCY = "BDT";
