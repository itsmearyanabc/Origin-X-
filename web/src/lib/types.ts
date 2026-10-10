// Shapes returned by the ORIGINX API (only the fields the UI uses).

export type OrgRole = "ORG_OWNER" | "ORG_ADMIN" | "ORG_MANAGER" | "ORG_OPERATOR" | "ORG_VIEWER";
export type PlatformRole = "NONE" | "SUPER_ADMIN" | "PLATFORM_ADMIN" | "SUPPORT_ADMIN" | "COMPLIANCE_ADMIN";
export type PublicState = "AUTHENTIC" | "HISTORY_VERIFIED" | "RECALLED" | "SUSPICIOUS" | "COUNTERFEIT" | "HISTORY_COMPROMISED" | "UNKNOWN";
export type TrustLevel = "EXCELLENT" | "TRUSTED" | "CAUTION" | "HIGH_RISK";

export type Me = {
  id: string;
  email: string;
  fullName: string;
  platformRole: PlatformRole;
  accountType: "PLATFORM_ADMIN" | "ORGANIZATION_USER";
  emailVerified: boolean;
  organizations: Array<{ organizationId: string; role: OrgRole; name: string; slug: string; status: string; verificationStatus: string }>;
};

export type OrgSummary = { id: string; name: string; slug?: string; organizationType?: string; verificationStatus: string; status?: string };

export type Organization = OrgSummary & {
  legalName: string | null;
  organizationType: string;
  additionalTypes: string[];
  industry: string | null;
  country: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  logo: string | null;
  status: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  createdAt: string;
  entitlements?: Entitlements;
};

export type Entitlements = {
  plan: string;
  status: string;
  subscriptionActive: boolean;
  limits: { products: number; users: number };
  usage: { products: number; users: number };
  remaining: { products: number; users: number };
  enforced: boolean;
};

export type TrustItem = { code: string; points: number; applied: boolean; reason: string };
export type Trust = {
  score: number;
  level: TrustLevel;
  factors: TrustItem[];
  penalties: TrustItem[];
  explanation: string;
  calculatedAt?: string;
  custody?: { consistent: boolean; issues: string[]; handoffs: number; custodians: string[] };
};

export type Proof = {
  id: string;
  kind: "IDENTITY" | "EVENT" | "STATUS";
  eventId: string | null;
  network: string;
  chainId: number | null;
  contractAddress: string | null;
  transactionHash: string | null;
  blockNumber: number | null;
  eventHash: string;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  createdAt: string;
  confirmedAt: string | null;
  lastError: string | null;
  explorerUrl?: string | null;
};

export type ProductListItem = {
  id: string;
  productCode: string;
  productName: string;
  category: string | null;
  serialNumber: string | null;
  status: string;
  trustScore: number;
  trustLevel: TrustLevel;
  riskLevel: string;
  verificationStatus: string;
  authenticityStatus: string;
  createdAt: string;
  batch: { batchCode: string } | null;
  identity: { status: string; isCanonical: boolean } | null;
  currentOwner: { id: string; name: string } | null;
};

export type ProductEvent = {
  id: string;
  sequence: number;
  eventType: string;
  timestamp: string;
  location: string | null;
  eventHash: string;
  previousEventHash: string;
  verificationStatus: string;
  organizationId: string;
  metadata: Record<string, unknown>;
  actorOrganization: OrgSummary | null;
  actorUser: { id: string; fullName: string } | null;
  proof: { status: string; transactionHash: string | null; blockNumber: number | null; network: string; chainId: number | null } | null;
};

export type ProductDetail = ProductListItem & {
  description: string | null;
  originCountry: string | null;
  originLocation: string | null;
  manufacturingDate: string | null;
  expiryDate: string | null;
  currentLocation: string | null;
  publicVerificationToken: string;
  blockchainIdentity: string | null;
  organizationId: string;
  currentOwnerOrganizationId: string | null;
  organization: OrgSummary;
  manufacturer: OrgSummary | null;
  identity: { status: string; isCanonical: boolean; identityHash: string; canonicalIdentityHash: string; blockchainIdentity: string | null } | null;
  trust: Trust;
  proofs: Proof[];
  incidents: Incident[];
  recalls: Recall[];
  relation: { isBrandOwner: boolean; isCurrentCustodian: boolean };
};

export type EventCheck = { eventId: string; sequence: number; eventType: string; storedHash: string; recomputedHash: string; contentValid: boolean; linkValid: boolean; status: "VALID" | "TAMPERED" | "BROKEN_LINK" | "AFFECTED" };

export type HistoryVerification = {
  historyValid: boolean;
  integrity: "VALID" | "COMPROMISED";
  eventCount: number;
  verifiedEventCount: number;
  tamperedEvents: Array<{ eventId: string; sequence: number; eventType: string; storedHash: string; recomputedHash: string; anchoredHash?: string; detectedBy?: string }>;
  brokenLinks: Array<{ eventId: string; sequence: number; expectedPreviousHash: string; actualPreviousHash: string }>;
  sequenceGaps: Array<{ expected: number; found: number }>;
  affectedEvents: string[];
  firstCompromisedSequence: number | null;
  passportIntegrity: { checked: boolean; valid: boolean; mismatchedFields: string[] };
  events: EventCheck[];
  verificationTimestamp: string;
  blockchainVerification: {
    status: "VERIFIED" | "PARTIALLY_ANCHORED" | "NOT_ANCHORED" | "MISMATCH" | "UNAVAILABLE";
    network: string;
    chainId: number | null;
    contractAddress: string | null;
    reason?: string;
    anchoredEvents: number;
    verifiedEvents: number;
    proofMismatches: number;
    contentMismatches: number;
    pendingProofs: number;
    proofs: Array<{ eventId: string | null; sequence: number | null; eventType: string | null; result: string; anchoredHash: string; transactionHash: string | null; blockNumber: number | null }>;
  };
  trust?: { score: number; level: TrustLevel };
};

export type Incident = {
  id: string;
  organizationId: string;
  productId: string | null;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  source: "MANUAL" | "SYSTEM";
  status: string;
  detectedAt: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  product?: { id: string; productCode: string; productName: string; status?: string } | null;
  organization?: { id: string; name: string };
};

export type Recall = {
  id: string;
  organizationId: string;
  productId: string | null;
  batchId: string | null;
  reason: string;
  status: string;
  affectedUnits: number | null;
  initiatedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  product?: { id: string; productCode: string; productName?: string } | null;
  batch?: { id?: string; batchCode: string } | null;
  organization?: { id: string; name: string };
};

export type CustodyTransfer = {
  id: string;
  productId: string;
  fromOrganizationId: string;
  toOrganizationId: string;
  status: string;
  note: string | null;
  receiptEventType: string | null;
  requestedAt: string;
  respondedAt: string | null;
  product: { id: string; productCode: string; productName: string; status: string };
  fromOrg: OrgSummary;
  toOrg: OrgSummary;
};

export type Relationship = {
  id: string;
  sourceOrganizationId: string;
  targetOrganizationId: string;
  relationshipType: string;
  status: string;
  createdAt: string;
  approvedAt: string | null;
  source: OrgSummary;
  target: OrgSummary;
};

export type Member = { id: string; role: OrgRole; status: string; createdAt: string; user: { id: string; email: string; fullName: string; status: string } };
export type Invitation = { id: string; email: string; role: OrgRole; status: string; expiresAt: string; createdAt: string };
export type Batch = { id: string; batchCode: string; name: string | null; manufacturedAt: string | null; expiryDate: string | null; createdAt: string; _count?: { products: number } };
export type AuditLog = { id: string; organizationId: string | null; actorUserId: string | null; action: string; resourceType: string; resourceId: string | null; metadata: Record<string, unknown>; timestamp: string };
export type VerificationLog = { id: string; productId: string | null; timestamp: string; result: string; source: string; ipHash?: string | null };

export type PublicVerification = {
  state: PublicState;
  headline: string;
  detail: string;
  tone: "positive" | "warning" | "danger" | "neutral";
  verifiedAt: string;
  identityVerified?: boolean;
  historyVerified?: boolean;
  blockchainVerified?: boolean;
  recalled?: boolean;
  warnings?: string[];
  passport?: {
    productName: string;
    productCode: string;
    serialNumber: string | null;
    category: string | null;
    description: string | null;
    brand: { name: string; verified: boolean; country: string | null };
    batch: string | null;
    origin: { country: string | null; location: string | null };
    manufacturingDate: string | null;
    expiryDate: string | null;
    currentStatus: string;
    trust: { score: number; level: TrustLevel; note: string | null; factors: string[]; penalties: string[] };
    integrity: { eventsVerified: number; eventCount: number; firstCompromisedEvent: number | null };
    recall: { status: string; initiatedAt: string | null; reason: string; affectedBatch: string | null } | null;
    lifecycle: Array<{
      sequence: number;
      eventType: string;
      timestamp: string;
      location: string | null;
      organization: { name: string; role: string; verified: boolean } | null;
      eventHash: string;
      integrity: string;
      blockchain: { result: string; transactionHash: string | null; explorerUrl: string | null } | null;
    }>;
    blockchain: {
      status: string;
      network: string;
      chainId: number | null;
      contractAddress: string | null;
      identity: { identityHash: string; transactionHash: string | null; explorerUrl: string | null } | null;
      verifiedEvents: number;
      anchoredEvents: number;
    };
  };
};

export type ChainStatus = {
  mode: string;
  configured: boolean;
  available: boolean;
  network: string;
  chainId: number | null;
  contractAddress: string | null;
  anchorer: string | null;
  latestBlock: number | null;
  onChainIdentityCount: number | null;
  onChainEventCount: number | null;
  reason?: string;
};

// ---------------------------------------------------------------------------
// Inventory layer
// ---------------------------------------------------------------------------

export type Sku = {
  id: string;
  organizationId: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  unitOfMeasure: string;
  allowsFractional: boolean;
  status: string;
  createdAt: string;
  _count?: { batches: number };
};

export type SkuStock = Sku & {
  owned: boolean;
  onHand: string;
  reserved: string;
  available: string;
  quarantined: string;
  damaged: string;
  batchCount: number;
  reorderThreshold: string | null;
  lowStock: boolean;
};

export type StorageLocation = { id: string; code: string; zone: string | null; aisle: string | null; shelf: string | null; bin: string | null; status: string; warehouseId: string };
export type Warehouse = { id: string; code: string; name: string; address: string | null; city: string | null; country: string | null; latitude: number | null; longitude: number | null; status: string; locations: StorageLocation[]; balanceCount?: number };

export type Balance = {
  id: string;
  organizationId: string;
  warehouseId: string;
  locationId: string;
  skuId: string;
  batchId: string | null;
  unitOfMeasure: string;
  onHand: string;
  reserved: string;
  available: string;
  quarantined: string;
  damaged: string;
  updatedAt: string;
  sku?: { id: string; sku: string; name: string; organizationId?: string };
  batch?: { id: string; batchCode: string; holdStatus: string; qualityStatus?: string; expiryDate: string | null; passportProductId?: string | null } | null;
  location?: { id: string; code: string; warehouse?: { id: string; code: string; name: string } };
};

export type InventoryTx = {
  id: string;
  type: string;
  quantity: string;
  unitOfMeasure: string;
  reason: string | null;
  createdAt: string;
  correlationId: string | null;
  shipmentId: string | null;
  recallId: string | null;
  incidentId: string | null;
  productEventId: string | null;
  actorName: string;
  sku: { id: string; sku: string; name: string } | null;
  batch: { id: string; batchCode: string } | null;
  fromLocation: { id: string; code: string; warehouse: { code: string; name: string } } | null;
  toLocation: { id: string; code: string; warehouse: { code: string; name: string } } | null;
  shipment: { id: string; reference: string } | null;
  entries: Array<{ bucket: string; delta: string }>;
};

export type InventorySummary = {
  activeSkus: number;
  trackedBatches: number;
  totalsByUnit: Array<{ unitOfMeasure: string; onHand: string; reserved: string; available: string; quarantined: string; damaged: string }>;
  incomingShipments: number;
  outgoingShipments: number;
  lowStockSkus: number;
  heldBalances: number;
  openDiscrepancies: number;
  recentMovements: InventoryTx[];
};

export type Discrepancy = { id: string; type: string; status: string; severity: string; message: string; details: Record<string, unknown>; shipmentId: string | null; createdAt: string; resolutionNote: string | null; organization?: { id: string; name: string } };

export type InventoryAlerts = {
  parameters: { expiringWithinDays: number; unconfirmedAfterDays: number };
  lowStock: Array<{ skuId: string; sku: string; name: string; available: string; threshold: string | null; unitOfMeasure: string }>;
  expiring: Array<Balance & { expired: boolean }>;
  unconfirmedIncoming: Array<{ id: string; reference: string; status: string; dispatchedAt: string }>;
  heldStock: Balance[];
  discrepancies: Discrepancy[];
};

export type ShipmentItemView = {
  id: string;
  skuId: string;
  batchId: string | null;
  fromLocationId: string | null;
  unitOfMeasure: string;
  requestedQty: string;
  dispatchedQty: string;
  receivedQty: string;
  damagedQty: string;
  missingQty: string;
  outstandingQty: string;
  sku?: { id: string; sku: string; name: string; unitOfMeasure: string };
  batch?: { id: string; batchCode: string; holdStatus: string; qualityStatus: string; expiryDate: string | null; passportProductId: string | null } | null;
  fromLocation?: { id: string; code: string } | null;
};

export type ShipmentView = {
  id: string;
  reference: string;
  senderOrganizationId: string;
  receiverOrganizationId: string;
  purpose: string;
  status: string;
  transferCustody: boolean;
  hasDiscrepancy: boolean;
  notes: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  direction: "incoming" | "outgoing";
  sender?: { id: string; name: string; verificationStatus: string };
  receiver?: { id: string; name: string; verificationStatus: string };
  items: ShipmentItemView[];
  originWarehouse?: { id?: string; code?: string; name?: string; city: string | null; country?: string | null } | null;
  destinationWarehouse?: { id?: string; code?: string; name?: string; city: string | null; country?: string | null } | null;
  custodyTransfers?: Array<{ id: string; productId: string; status: string }>;
  transactions?: Array<{ id: string; type: string; quantity: string; createdAt: string }>;
};

export type BatchRow = Batch & {
  organizationId: string;
  skuId: string | null;
  unitOfMeasure: string | null;
  plannedQuantity: string | null;
  qualityStatus: string;
  holdStatus: string;
  passportProductId: string | null;
};
