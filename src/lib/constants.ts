export const PLATFORM_ROLES = {
  NONE: "NONE",
  SUPER_ADMIN: "SUPER_ADMIN",
  PLATFORM_ADMIN: "PLATFORM_ADMIN",
  SUPPORT_ADMIN: "SUPPORT_ADMIN",
  COMPLIANCE_ADMIN: "COMPLIANCE_ADMIN",
} as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[keyof typeof PLATFORM_ROLES];
export const ADMIN_ROLES = [
  PLATFORM_ROLES.SUPER_ADMIN,
  PLATFORM_ROLES.PLATFORM_ADMIN,
  PLATFORM_ROLES.SUPPORT_ADMIN,
  PLATFORM_ROLES.COMPLIANCE_ADMIN,
] as const;

export const ORG_ROLES = {
  ORG_OWNER: "ORG_OWNER",
  ORG_ADMIN: "ORG_ADMIN",
  ORG_MANAGER: "ORG_MANAGER",
  ORG_OPERATOR: "ORG_OPERATOR",
  ORG_VIEWER: "ORG_VIEWER",
} as const;
export type OrgRole = (typeof ORG_ROLES)[keyof typeof ORG_ROLES];
export const ORG_ROLE_LIST = Object.values(ORG_ROLES) as [OrgRole, ...OrgRole[]];

const { ORG_OWNER: OWNER, ORG_ADMIN: ADMIN, ORG_MANAGER: MANAGER, ORG_OPERATOR: OPERATOR, ORG_VIEWER: VIEWER } = ORG_ROLES;

/**
 * Organization RBAC. Every protected tenant route declares one permission; the role list is the
 * single source of truth (documented in docs/SECURITY.md).
 */
export const ORG_PERMISSIONS = {
  "org:read": [OWNER, ADMIN, MANAGER, OPERATOR, VIEWER],
  "org:settings": [OWNER],
  "org:billing": [OWNER],
  "members:read": [OWNER, ADMIN, MANAGER, OPERATOR, VIEWER],
  "members:manage": [OWNER, ADMIN],
  "relationships:read": [OWNER, ADMIN, MANAGER, OPERATOR, VIEWER],
  "relationships:manage": [OWNER, ADMIN],
  "products:read": [OWNER, ADMIN, MANAGER, OPERATOR, VIEWER],
  "products:create": [OWNER, ADMIN, MANAGER],
  "products:update": [OWNER, ADMIN, MANAGER],
  "products:archive": [OWNER, ADMIN],
  "events:create": [OWNER, ADMIN, MANAGER, OPERATOR],
  "custody:request": [OWNER, ADMIN, MANAGER],
  "custody:respond": [OWNER, ADMIN, MANAGER],
  "incidents:read": [OWNER, ADMIN, MANAGER, OPERATOR, VIEWER],
  "incidents:create": [OWNER, ADMIN, MANAGER, OPERATOR],
  "incidents:manage": [OWNER, ADMIN],
  "recalls:read": [OWNER, ADMIN, MANAGER, OPERATOR, VIEWER],
  "recalls:manage": [OWNER, ADMIN],
  "verification:scan": [OWNER, ADMIN, MANAGER, OPERATOR, VIEWER],
  "analytics:read": [OWNER, ADMIN, MANAGER, VIEWER],
  "audit:read": [OWNER, ADMIN],
  "demo:tamper": [OWNER, ADMIN],
  // Inventory layer
  "inventory:read": [OWNER, ADMIN, MANAGER, OPERATOR, VIEWER],
  "inventory:receive": [OWNER, ADMIN, MANAGER, OPERATOR],
  "inventory:move": [OWNER, ADMIN, MANAGER, OPERATOR],
  "inventory:reserve": [OWNER, ADMIN, MANAGER],
  "inventory:dispatch": [OWNER, ADMIN, MANAGER],
  "inventory:quarantine": [OWNER, ADMIN, MANAGER],
  "inventory:adjust": [OWNER, ADMIN],
  "warehouses:manage": [OWNER, ADMIN],
  "catalogue:manage": [OWNER, ADMIN, MANAGER],
  "shipments:manage": [OWNER, ADMIN, MANAGER],
  "shipments:receive": [OWNER, ADMIN, MANAGER, OPERATOR],
} as const satisfies Record<string, readonly OrgRole[]>;
export type OrgPermission = keyof typeof ORG_PERMISSIONS;

/** Platform (ORIGINX staff) permissions. */
export const ADMIN_PERMISSIONS = {
  "admin:read": [...ADMIN_ROLES],
  "admin:orgs:manage": [PLATFORM_ROLES.SUPER_ADMIN, PLATFORM_ROLES.PLATFORM_ADMIN],
  "admin:subscriptions": [PLATFORM_ROLES.SUPER_ADMIN, PLATFORM_ROLES.PLATFORM_ADMIN],
  "admin:users:manage": [PLATFORM_ROLES.SUPER_ADMIN],
  "admin:settings": [PLATFORM_ROLES.SUPER_ADMIN],
  "admin:compliance": [PLATFORM_ROLES.SUPER_ADMIN, PLATFORM_ROLES.PLATFORM_ADMIN, PLATFORM_ROLES.COMPLIANCE_ADMIN],
  "admin:audit": [PLATFORM_ROLES.SUPER_ADMIN, PLATFORM_ROLES.PLATFORM_ADMIN, PLATFORM_ROLES.COMPLIANCE_ADMIN],
  "admin:blockchain": [PLATFORM_ROLES.SUPER_ADMIN, PLATFORM_ROLES.PLATFORM_ADMIN],
} as const;
export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;

export const ORG_TYPES = [
  "MANUFACTURER",
  "DISTRIBUTOR",
  "LOGISTICS",
  "WAREHOUSE",
  "RETAILER",
  "BRAND",
  "SUPPLIER",
  "OTHER",
] as const;

export const ORG_STATUS = ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"] as const;
export const ORG_VERIFICATION_STATUS = ["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"] as const;

export const PLANS = {
  FREE: { productLimit: 100, userLimit: 3 },
  STARTER: { productLimit: 1_000, userLimit: 10 },
  GROWTH: { productLimit: 10_000, userLimit: 50 },
  ENTERPRISE: { productLimit: null, userLimit: null }, // custom: set per organization
} as const;
export type PlanName = keyof typeof PLANS;
export const PLAN_NAMES = Object.keys(PLANS) as [PlanName, ...PlanName[]];

export const PRODUCT_STATUS = ["ACTIVE", "DELIVERED", "RECALLED", "SUSPENDED", "ARCHIVED", "QUARANTINED"] as const;

export const EVENT_TYPES = [
  "PRODUCT_REGISTERED",
  "MANUFACTURED",
  "QUALITY_APPROVED",
  "SHIPMENT_CREATED",
  "CUSTODY_TRANSFERRED",
  "RECEIVED",
  "WAREHOUSE_RECEIVED",
  "RETAILER_RECEIVED",
  "DELIVERED",
  "CERTIFICATE_ADDED",
  "DOCUMENT_ADDED",
  "STATUS_CHANGED",
  "INCIDENT_CREATED",
  "RECALL_INITIATED",
  // Inventory layer: quantity movements recorded on batch passports
  "DISPATCHED",
  "RECALL_RETURN_RECEIVED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Only the product's registering (brand-owner) organization may record these. */
export const OWNER_EVENT_TYPES: EventType[] = ["MANUFACTURED", "QUALITY_APPROVED", "CERTIFICATE_ADDED", "STATUS_CHANGED"];
/** Only the current custodian may record these. */
export const CUSTODIAN_EVENT_TYPES: EventType[] = [
  "SHIPMENT_CREATED",
  "RECEIVED",
  "WAREHOUSE_RECEIVED",
  "RETAILER_RECEIVED",
  "DELIVERED",
];
/** Owner or current custodian. */
export const SHARED_EVENT_TYPES: EventType[] = ["DOCUMENT_ADDED"];
/** Created exclusively by the platform's own workflows (registration, custody, incidents, recalls). */
export const SYSTEM_EVENT_TYPES: EventType[] = [
  "PRODUCT_REGISTERED",
  "CUSTODY_TRANSFERRED",
  "INCIDENT_CREATED",
  "RECALL_INITIATED",
  "DISPATCHED",
  "RECALL_RETURN_RECEIVED",
];
export const MANUAL_EVENT_TYPES = [...OWNER_EVENT_TYPES, ...CUSTODIAN_EVENT_TYPES, ...SHARED_EVENT_TYPES] as [
  EventType,
  ...EventType[],
];
/** Event types the receiving organization may use to record a custody handoff. */
export const HANDOFF_EVENT_TYPES = ["CUSTODY_TRANSFERRED", "RECEIVED", "WAREHOUSE_RECEIVED", "RETAILER_RECEIVED"] as const;
/** With BLOCKCHAIN_ANCHOR_POLICY=critical only these are anchored individually. */
export const CRITICAL_EVENT_TYPES: EventType[] = [
  "PRODUCT_REGISTERED",
  "QUALITY_APPROVED",
  "CUSTODY_TRANSFERRED",
  "WAREHOUSE_RECEIVED",
  "RETAILER_RECEIVED",
  "DELIVERED",
  "RECALL_INITIATED",
  "STATUS_CHANGED",
  "DISPATCHED",
  "RECALL_RETURN_RECEIVED",
];

export const RELATIONSHIP_TYPES = [
  "SUPPLIER",
  "DISTRIBUTOR",
  "LOGISTICS_PROVIDER",
  "WAREHOUSE",
  "RETAILER",
  "CUSTOMER",
  "PARTNER",
] as const;
export const RELATIONSHIP_STATUS = ["REQUESTED", "ACCEPTED", "REJECTED", "SUSPENDED"] as const;

export const INCIDENT_TYPES = [
  "IDENTITY_COLLISION",
  "TAMPERED_RECORD",
  "INVALID_BLOCKCHAIN_PROOF",
  "BROKEN_CUSTODY_CHAIN",
  "UNVERIFIED_ORGANIZATION",
  "SUSPICIOUS_TRANSFER",
  "SUSPICIOUS_VERIFICATION_PATTERN",
  "COUNTERFEIT",
  "OTHER",
] as const;
export const INCIDENT_SEVERITY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const INCIDENT_STATUS = ["OPEN", "INVESTIGATING", "RESOLVED", "DISMISSED", "RECALLED"] as const;
export const OPEN_INCIDENT_STATUS = ["OPEN", "INVESTIGATING"];

export const RECALL_STATUS = ["DRAFT", "INITIATED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const ACTIVE_RECALL_STATUS = ["INITIATED", "IN_PROGRESS", "COMPLETED"];

export const IDENTITY_STATUS = ["ACTIVE", "SUSPENDED", "RECALLED", "COUNTERFEIT", "REVOKED"] as const;
export type IdentityStatus = (typeof IDENTITY_STATUS)[number];
/** On-chain status codes (must match OriginXProofAnchor.sol). */
export const CHAIN_IDENTITY_STATUS: Record<IdentityStatus, number> = {
  ACTIVE: 1,
  SUSPENDED: 2,
  RECALLED: 3,
  COUNTERFEIT: 4,
  REVOKED: 5,
};

export const PUBLIC_STATES = {
  AUTHENTIC: "AUTHENTIC",
  HISTORY_VERIFIED: "HISTORY_VERIFIED",
  RECALLED: "RECALLED",
  SUSPICIOUS: "SUSPICIOUS",
  COUNTERFEIT: "COUNTERFEIT",
  HISTORY_COMPROMISED: "HISTORY_COMPROMISED",
  UNKNOWN: "UNKNOWN",
} as const;
export type PublicState = (typeof PUBLIC_STATES)[keyof typeof PUBLIC_STATES];

export const GENESIS_HASH = "0".repeat(64);
export const EVENT_HASH_VERSION = 1;

// ---------------------------------------------------------------------------
// Inventory layer
// ---------------------------------------------------------------------------

/** Units of measure. `fractional` units accept up to 4 decimal places; others must be whole numbers. */
export const UNITS_OF_MEASURE = {
  PCS: { label: "Pieces", fractional: false },
  BOX: { label: "Boxes", fractional: false },
  CARTON: { label: "Cartons", fractional: false },
  PALLET: { label: "Pallets", fractional: false },
  PACK: { label: "Packs", fractional: false },
  DOSE: { label: "Doses", fractional: false },
  VIAL: { label: "Vials", fractional: false },
  KG: { label: "Kilograms", fractional: true },
  G: { label: "Grams", fractional: true },
  L: { label: "Litres", fractional: true },
  ML: { label: "Millilitres", fractional: true },
  M: { label: "Metres", fractional: true },
} as const;
export type UnitOfMeasure = keyof typeof UNITS_OF_MEASURE;
export const UNIT_CODES = Object.keys(UNITS_OF_MEASURE) as [UnitOfMeasure, ...UnitOfMeasure[]];

export const INVENTORY_TX_TYPES = [
  "OPENING_BALANCE",
  "RECEIPT",
  "DISPATCH",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "RESERVATION",
  "RESERVATION_RELEASE",
  "CUSTOMER_RETURN",
  "SUPPLIER_RETURN",
  "DAMAGE",
  "LOSS",
  "STOCK_ADJUSTMENT",
  "QUARANTINE",
  "QUARANTINE_RELEASE",
  "RECALL_ALLOCATION",
  "RECALL_RETURN",
] as const;
export type InventoryTxType = (typeof INVENTORY_TX_TYPES)[number];

export const BALANCE_BUCKETS = ["ON_HAND", "RESERVED", "QUARANTINED", "DAMAGED"] as const;
export type BalanceBucket = (typeof BALANCE_BUCKETS)[number];

export const SHIPMENT_STATUS = ["DRAFT", "RESERVED", "READY_TO_DISPATCH", "DISPATCHED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED", "REJECTED", "RETURNED"] as const;
export const OPEN_SHIPMENT_STATUS = ["DRAFT", "RESERVED", "READY_TO_DISPATCH", "DISPATCHED", "PARTIALLY_RECEIVED", "REJECTED"];
export const BATCH_QUALITY_STATUS = ["PENDING", "APPROVED", "REJECTED"] as const;
export const BATCH_HOLD_STATUS = ["NONE", "QUARANTINED", "RECALLED"] as const;
