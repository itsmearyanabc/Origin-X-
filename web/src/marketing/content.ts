import {
  Bell,
  Blocks,
  Bot,
  Building2,
  ClipboardList,
  Fingerprint,
  Gauge,
  Handshake,
  Link2,
  Lock,
  QrCode,
  ScanSearch,
  ShieldCheck,
  Siren,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type Feature = { icon: LucideIcon; title: string; text: string; points: string[] };

export const FEATURES: Feature[] = [
  {
    icon: QrCode,
    title: "Digital Product Passport",
    text: "One living record for every product or batch: identity, origin, batch, custody, status, proofs and recalls.",
    points: ["Sealed origin & batch data", "Unique, unguessable QR token", "Private and public views"],
  },
  {
    icon: Link2,
    title: "Tamper-evident history",
    text: "Each lifecycle event is SHA-256 linked to the one before it. Edits, deletions and re-ordering are detected instantly.",
    points: ["Server-computed hashes", "Database-enforced immutability", "Exact event pinpointing"],
  },
  {
    icon: Blocks,
    title: "Blockchain proofs",
    text: "Identities, events and recall statuses are anchored on an EVM blockchain. Only hashes go on-chain — never your data.",
    points: ["Write-once anchors", "Read back on every scan", "Explorer links for anyone"],
  },
  {
    icon: Handshake,
    title: "Two-party custody",
    text: "Custody only moves when the receiving company accepts it. Nobody can assign ownership to someone else.",
    points: ["Partners only", "Request → accept → record", "Both sides audited"],
  },
  {
    icon: Gauge,
    title: "Explainable trust score",
    text: "A deterministic 0–100 score from verified facts: organization, origin, custody, cryptography, proofs, incidents.",
    points: ["Every point explained", "No black box", "Score history over time"],
  },
  {
    icon: Fingerprint,
    title: "Counterfeit detection",
    text: "Product identities are global. A second registration of the same identity is quarantined as a potential counterfeit.",
    points: ["Identity-collision alerts", "Cloned-QR scan detection", "Clone sees nothing of the original"],
  },
  {
    icon: Siren,
    title: "Incidents & recalls",
    text: "Tampering, broken custody and collisions raise incidents automatically. Recall a product or a whole batch in one step.",
    points: ["Consumers see RECALLED instantly", "Recall status anchored on-chain", "Batch-wide reach"],
  },
  {
    icon: ClipboardList,
    title: "Append-only audit trail",
    text: "Every sensitive action is logged, and the database itself refuses to edit or delete audit history.",
    points: ["Admin actions included", "Privacy-preserving IP hashes", "Exportable evidence"],
  },
  {
    icon: Bot,
    title: "Ask ORIGINX",
    text: "Ask in plain language why a score dropped or where a batch has been. Answers come only from verified records.",
    points: ["Grounded in facts", "Works without AI as well", "Never invents data"],
  },
];

export const EXPERIENCES = [
  {
    key: "org",
    icon: Building2,
    title: "Organization panel",
    who: "Manufacturers, distributors, logistics, warehouses, retailers",
    points: ["Register products & batches", "Record lifecycle events", "Send & accept custody", "Partners, team & roles", "Incidents, recalls, analytics"],
  },
  {
    key: "consumer",
    icon: ScanSearch,
    title: "Consumer verification",
    who: "Anyone holding the product",
    points: ["Scan a QR — no account", "Authenticity & origin", "Full journey timeline", "Trust score & blockchain proof", "Unmissable recall warnings"],
  },
  {
    key: "admin",
    icon: ShieldCheck,
    title: "ORIGINX admin",
    who: "The ORIGINX platform team",
    points: ["Approve & verify organizations", "Monitor verification & fraud", "Review collisions & incidents", "Blockchain health", "Audit everything"],
  },
] as const;

export const COMPARISON = {
  columns: ["ORIGINX", "Spreadsheets & ERPs", "Blockchain-only tracking"],
  rows: [
    ["Consumers verify with one scan, no app", true, false, "partial"],
    ["Detects edited or deleted history", true, false, "partial"],
    ["Catches a full database rewrite", true, false, true],
    ["Counterfeit / identity-collision detection", true, false, false],
    ["Recall status shown on every scan", true, false, false],
    ["Custody moves only when the receiver accepts", true, false, "partial"],
    ["Explains its trust decision", true, false, false],
    ["No private data on a public ledger", true, true, false],
    ["No IoT or special hardware needed", true, true, "partial"],
  ] as Array<[string, boolean | "partial", boolean | "partial", boolean | "partial"]>,
};

export const PRIVACY_POINTS = [
  { icon: Lock, title: "Only hashes on-chain", text: "Organization data, documents and personal data never touch the blockchain." },
  { icon: Users, title: "Isolated tenants", text: "Every company's data is separated and enforced on the server — never just hidden in the UI." },
  { icon: UserCheck, title: "No consumer accounts", text: "Verification needs no sign-up. Scans are logged with salted hashes, never raw IPs." },
  { icon: Bell, title: "Honest by default", text: "If the chain can't be reached, proofs say PENDING. Nothing is ever faked or assumed." },
];

export const PLANS = [
  { name: "Free", price: "₹0", period: "forever", tagline: "Pilot ORIGINX with a few SKUs.", limits: ["100 products", "3 team members"], features: ["Digital Product Passports", "Hash-chained history", "Blockchain proofs", "Consumer verification"], cta: "Start free" },
  { name: "Starter", price: "Contact", period: "", tagline: "For growing brands and partners.", limits: ["1,000 products", "10 team members"], features: ["Everything in Free", "Custody transfers & partners", "Incidents & recalls", "Analytics"], cta: "Choose Starter" },
  { name: "Growth", price: "Contact", period: "", tagline: "Multi-site supply chains.", limits: ["10,000 products", "50 team members"], features: ["Everything in Starter", "Batch recalls", "Audit log exports", "Priority support"], cta: "Choose Growth", featured: true },
  { name: "Enterprise", price: "Custom", period: "", tagline: "Regulated, high-volume networks.", limits: ["Custom limits", "Custom roles"], features: ["Everything in Growth", "Dedicated chain & contract", "SLA & security review", "On-boarding for partners"], cta: "Talk to us" },
];

export const FAQ = [
  ["Do we need IoT sensors, RFID or special hardware?", "No. ORIGINX works with the QR codes you already print. Lifecycle events are recorded by the people and systems that handle the product."],
  ["What actually goes on the blockchain?", "Only 32-byte cryptographic hashes: the product identity, each anchored event, and status changes such as recalls. No names, addresses, documents or personal data."],
  ["What stops someone from editing our records?", "Three layers: the database refuses edits to history, every event is hash-linked to the one before it, and the original hashes are anchored on a blockchain that cannot be rewritten."],
  ["How is a counterfeit detected?", "Product identities are global. If another organization registers an identity that already exists, the new record is quarantined, the genuine owner is alerted and anyone scanning the clone sees COUNTERFEIT."],
  ["Do consumers need an app or account?", "No. Scanning the QR opens a public verification page in any browser. It only shows approved, non-sensitive information."],
  ["Can one company see another company's data?", "No. Every organization's data is isolated on the server. Partners only see the shared custody history of products they have actually handled."],
  ["What happens during a recall?", "The brand owner recalls a product or batch. Every unit is marked recalled, the status is anchored on-chain, and every future scan shows a clear RECALLED warning."],
];

export const INDUSTRIES = ["Pharmaceuticals", "Vaccines & biologics", "Consumer electronics", "Luxury goods", "Auto parts", "Food & beverage", "Cosmetics", "Agrochemicals", "Medical devices", "Spirits & wine"];
