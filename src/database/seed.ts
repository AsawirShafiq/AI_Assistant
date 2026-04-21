import { connectDB, closeDB } from "./connection";
import { LeadModel } from "./schemas/lead.schema";
import { UserPreferencesModel } from "./schemas/memory.schema";

// ─── Helper: offset dates from today ─────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

// ─── 20 Realistic Leads ─────────────────────────────────

const LEADS = [
  // ── Fintech (5) ────────────────────────────────────────
  {
    company: "FinFlow Inc.",
    contactName: "Sarah Chen",
    contactEmail: "sarah.chen@finflow.io",
    contactPhone: "+1-212-555-0101",
    contactTitle: "VP of Engineering",
    industry: "fintech",
    location: "New York, NY",
    dealStage: "prospecting",
    companySize: "startup",
    estimatedValue: 35_000,
    source: "linkedin",
    priority: "high",
    tags: ["payments", "series-a", "fast-growth"],
    notes: "Series A startup building payments infrastructure. Raised $12M. Actively hiring — good timing for outreach.",
    lastContactedAt: null,
    nextFollowUp: daysFromNow(1),
  },
  {
    company: "PayBridge",
    contactName: "Marcus Williams",
    contactEmail: "m.williams@paybridge.com",
    contactPhone: "+1-212-555-0102",
    contactTitle: "CTO",
    industry: "fintech",
    location: "New York, NY",
    dealStage: "qualified",
    companySize: "mid-market",
    estimatedValue: 85_000,
    source: "referral",
    priority: "high",
    tags: ["fraud-detection", "compliance", "enterprise-ready"],
    notes: "Looking for fraud detection solutions. Had intro call 2 weeks ago — very engaged. Requested pricing doc.",
    lastContactedAt: daysAgo(14),
    nextFollowUp: daysFromNow(2),
  },
  {
    company: "NeoBank Labs",
    contactName: "Priya Patel",
    contactEmail: "priya@neobanklabs.com",
    contactPhone: "+1-415-555-0103",
    contactTitle: "CEO & Co-founder",
    industry: "fintech",
    location: "San Francisco, CA",
    dealStage: "prospecting",
    companySize: "startup",
    estimatedValue: 20_000,
    source: "conference",
    priority: "medium",
    tags: ["digital-banking", "pre-revenue", "yc-batch"],
    notes: "Met at FinTech Connect 2026. Digital banking platform, pre-revenue but backed by Y Combinator.",
    lastContactedAt: daysAgo(30),
    nextFollowUp: daysFromNow(3),
  },
  {
    company: "LedgerPrime",
    contactName: "Daniel Okafor",
    contactEmail: "d.okafor@ledgerprime.com",
    contactPhone: "+1-312-555-0104",
    contactTitle: "Head of Product",
    industry: "fintech",
    location: "Chicago, IL",
    dealStage: "proposal",
    companySize: "mid-market",
    estimatedValue: 120_000,
    source: "cold_call",
    priority: "high",
    tags: ["accounting", "api-first", "proposal-sent"],
    notes: "Sent proposal last week for API integration tier. Decision expected by end of month. Champion is Daniel.",
    lastContactedAt: daysAgo(7),
    nextFollowUp: daysFromNow(5),
  },
  {
    company: "Apex Capital Tech",
    contactName: "Rachel Foster",
    contactEmail: "rachel.f@apexcapitaltech.com",
    contactPhone: "+1-305-555-0105",
    contactTitle: "Director of Operations",
    industry: "fintech",
    location: "Miami, FL",
    dealStage: "closed_won",
    companySize: "enterprise",
    estimatedValue: 250_000,
    source: "partner",
    priority: "low",
    tags: ["wealth-management", "closed", "upsell-candidate"],
    notes: "Closed $250K deal in Q1. Running our platform for wealth management. Good candidate for upsell to premium tier.",
    lastContactedAt: daysAgo(45),
    nextFollowUp: daysFromNow(30),
  },

  // ── SaaS (5) ──────────────────────────────────────────
  {
    company: "CloudScale AI",
    contactName: "James Rodriguez",
    contactEmail: "james@cloudscale.ai",
    contactPhone: "+1-512-555-0106",
    contactTitle: "CEO",
    industry: "saas",
    location: "Austin, TX",
    dealStage: "proposal",
    companySize: "mid-market",
    estimatedValue: 95_000,
    source: "website",
    priority: "high",
    tags: ["ai-infra", "fast-growth", "50-employees"],
    notes: "AI infrastructure company, 50 employees. Requested enterprise demo. Proposal sent — awaiting feedback.",
    lastContactedAt: daysAgo(5),
    nextFollowUp: daysFromNow(2),
  },
  {
    company: "DataVault",
    contactName: "Emily Thompson",
    contactEmail: "emily.t@datavault.com",
    contactPhone: "+1-212-555-0107",
    contactTitle: "VP of Sales",
    industry: "saas",
    location: "New York, NY",
    dealStage: "prospecting",
    companySize: "enterprise",
    estimatedValue: 200_000,
    source: "linkedin",
    priority: "high",
    tags: ["data-platform", "fortune-500", "high-value"],
    notes: "Enterprise data platform serving Fortune 500 clients. Huge potential deal. Need to get past gatekeeper.",
    lastContactedAt: null,
    nextFollowUp: daysFromNow(1),
  },
  {
    company: "FlowStack",
    contactName: "Kevin Zhao",
    contactEmail: "kevin@flowstack.io",
    contactPhone: "+1-206-555-0108",
    contactTitle: "Head of Engineering",
    industry: "saas",
    location: "Seattle, WA",
    dealStage: "negotiation",
    companySize: "mid-market",
    estimatedValue: 75_000,
    source: "referral",
    priority: "high",
    tags: ["devtools", "ci-cd", "contract-stage"],
    notes: "Developer tooling company. In contract negotiation — legal reviewing MSA. Expected close in 2 weeks.",
    lastContactedAt: daysAgo(3),
    nextFollowUp: daysFromNow(4),
  },
  {
    company: "BrightMetrics",
    contactName: "Laura Jimenez",
    contactEmail: "laura@brightmetrics.com",
    contactPhone: "+1-720-555-0109",
    contactTitle: "COO",
    industry: "saas",
    location: "Denver, CO",
    dealStage: "qualified",
    companySize: "startup",
    estimatedValue: 30_000,
    source: "conference",
    priority: "medium",
    tags: ["analytics", "smb-focus", "demo-scheduled"],
    notes: "Analytics dashboard for SMBs. Demo scheduled for next week. Budget confirmed at $30K/yr.",
    lastContactedAt: daysAgo(10),
    nextFollowUp: daysFromNow(3),
  },
  {
    company: "ShipLogix",
    contactName: "Omar Hassan",
    contactEmail: "omar@shiploqix.com",
    contactTitle: "Founder",
    industry: "saas",
    location: "Austin, TX",
    dealStage: "closed_lost",
    companySize: "startup",
    estimatedValue: 15_000,
    source: "cold_call",
    priority: "low",
    tags: ["logistics", "lost-to-competitor", "re-engage-q3"],
    notes: "Lost to competitor (ShipBob) on price. Revisit in Q3 when their contract renews.",
    lastContactedAt: daysAgo(60),
    nextFollowUp: daysFromNow(90),
  },

  // ── HealthTech (3) ────────────────────────────────────
  {
    company: "HealthSync",
    contactName: "David Kim",
    contactEmail: "dkim@healthsync.io",
    contactPhone: "+1-617-555-0110",
    contactTitle: "Chief Product Officer",
    industry: "healthtech",
    location: "Boston, MA",
    dealStage: "qualified",
    companySize: "mid-market",
    estimatedValue: 110_000,
    source: "referral",
    priority: "high",
    tags: ["ehr", "hipaa", "integration"],
    notes: "EHR integration platform. Need HIPAA-compliant solution. Referred by Dr. Sarah Lin at MassGeneral.",
    lastContactedAt: daysAgo(7),
    nextFollowUp: daysFromNow(1),
  },
  {
    company: "MedGenome Analytics",
    contactName: "Aisha Nguyen",
    contactEmail: "aisha@medgenome.co",
    contactPhone: "+1-858-555-0111",
    contactTitle: "Director of Partnerships",
    industry: "healthtech",
    location: "San Diego, CA",
    dealStage: "prospecting",
    companySize: "mid-market",
    estimatedValue: 60_000,
    source: "linkedin",
    priority: "medium",
    tags: ["genomics", "research", "b2b"],
    notes: "Genomics analytics firm selling to pharma companies. Could be a good partnership channel.",
    lastContactedAt: null,
    nextFollowUp: daysFromNow(5),
  },
  {
    company: "CarePoint Systems",
    contactName: "Robert Walsh",
    contactEmail: "r.walsh@carepoint.health",
    contactPhone: "+1-215-555-0112",
    contactTitle: "VP of Technology",
    industry: "healthtech",
    location: "Philadelphia, PA",
    dealStage: "negotiation",
    companySize: "enterprise",
    estimatedValue: 180_000,
    source: "partner",
    priority: "high",
    tags: ["telehealth", "enterprise", "multi-year"],
    notes: "Telehealth platform. Negotiating 3-year enterprise contract. Legal review in progress.",
    lastContactedAt: daysAgo(2),
    nextFollowUp: daysFromNow(7),
  },

  // ── CleanTech (2) ─────────────────────────────────────
  {
    company: "GreenGrid Energy",
    contactName: "Anna Johansson",
    contactEmail: "anna@greengrid.energy",
    contactPhone: "+1-720-555-0113",
    contactTitle: "CEO",
    industry: "cleantech",
    location: "Denver, CO",
    dealStage: "prospecting",
    companySize: "startup",
    estimatedValue: 25_000,
    source: "conference",
    priority: "medium",
    tags: ["smart-grid", "analytics", "climate"],
    notes: "Smart grid analytics startup. Won CleanTech Innovation Award. Bootstrapped, looking for first enterprise tool.",
    lastContactedAt: daysAgo(20),
    nextFollowUp: daysFromNow(5),
  },
  {
    company: "SolarEdge Solutions",
    contactName: "Michael Torres",
    contactEmail: "m.torres@solaredgesolutions.com",
    contactTitle: "Head of Sales",
    industry: "cleantech",
    location: "Phoenix, AZ",
    dealStage: "qualified",
    companySize: "mid-market",
    estimatedValue: 55_000,
    source: "website",
    priority: "medium",
    tags: ["solar", "b2b", "southwest"],
    notes: "Solar panel installation management platform. Inbound lead from website. Booked discovery call.",
    lastContactedAt: daysAgo(5),
    nextFollowUp: daysFromNow(2),
  },

  // ── E-commerce (3) ────────────────────────────────────
  {
    company: "CartGenius",
    contactName: "Tanya Reeves",
    contactEmail: "tanya@cartgenius.com",
    contactPhone: "+1-646-555-0114",
    contactTitle: "Head of Growth",
    industry: "ecommerce",
    location: "New York, NY",
    dealStage: "proposal",
    companySize: "startup",
    estimatedValue: 40_000,
    source: "referral",
    priority: "medium",
    tags: ["checkout-optimization", "shopify", "d2c"],
    notes: "AI checkout optimization for Shopify stores. Proposal sent for 50-store pilot. Decision maker is CEO (Tom).",
    lastContactedAt: daysAgo(8),
    nextFollowUp: daysFromNow(3),
  },
  {
    company: "RetailRadar",
    contactName: "Ben Schwartz",
    contactEmail: "ben.s@retailradar.io",
    contactTitle: "CTO",
    industry: "ecommerce",
    location: "Los Angeles, CA",
    dealStage: "prospecting",
    companySize: "mid-market",
    estimatedValue: 70_000,
    source: "cold_call",
    priority: "low",
    tags: ["inventory", "analytics", "retail"],
    notes: "Retail analytics platform. Cold outreach — no response to first email. Try LinkedIn approach.",
    lastContactedAt: daysAgo(15),
    nextFollowUp: daysFromNow(1),
  },

  // ── Cybersecurity (2) ─────────────────────────────────
  {
    company: "VaultShield",
    contactName: "Natasha Ivanova",
    contactEmail: "n.ivanova@vaultshield.com",
    contactPhone: "+1-571-555-0115",
    contactTitle: "CISO",
    industry: "cybersecurity",
    location: "Washington, DC",
    dealStage: "qualified",
    companySize: "enterprise",
    estimatedValue: 300_000,
    source: "partner",
    priority: "high",
    tags: ["zero-trust", "government", "compliance"],
    notes: "Zero-trust security platform. Government contracts. Needs SOC2 & FedRAMP certification. Massive deal potential.",
    lastContactedAt: daysAgo(4),
    nextFollowUp: daysFromNow(3),
  },
  {
    company: "CipherLayer",
    contactName: "Alex Pham",
    contactEmail: "alex@cipherlayer.io",
    contactTitle: "VP of Engineering",
    industry: "cybersecurity",
    location: "San Francisco, CA",
    dealStage: "prospecting",
    companySize: "startup",
    estimatedValue: 28_000,
    source: "linkedin",
    priority: "medium",
    tags: ["encryption", "api-security", "seed-stage"],
    notes: "API security startup. Seed stage, 8 employees. Interesting tech but limited budget. Good long-term prospect.",
    lastContactedAt: null,
    nextFollowUp: daysFromNow(7),
  },
];

// ─── Default User Preferences ────────────────────────────

const DEFAULT_PREFERENCES = {
  userId: "default_user",
  tone: "professional",
  preferredLength: "medium",
  signature: "",
  signOff: "Best regards",
  senderName: "Alex Morgan",
  senderTitle: "Account Executive",
  companyName: "TechSolutions Corp",
  avoidPhrases: ["touching base", "circle back", "synergy", "low-hanging fruit"],
  styleNotes: [],
  preferredTemplates: [],
};

// ─── Seed Function ───────────────────────────────────────

async function seed(): Promise<void> {
  await connectDB();

  // Clear existing data
  await LeadModel.deleteMany({});
  await UserPreferencesModel.deleteMany({});
  console.log("[seed] Cleared existing data");

  // Insert leads
  const inserted = await LeadModel.insertMany(LEADS);
  console.log(`[seed] Inserted ${inserted.length} leads`);

  // Stage summary
  const stages = LEADS.reduce<Record<string, number>>((acc, l) => {
    acc[l.dealStage] = (acc[l.dealStage] || 0) + 1;
    return acc;
  }, {});
  console.log("[seed] Pipeline breakdown:", stages);

  // Insert default preferences
  await UserPreferencesModel.create(DEFAULT_PREFERENCES);
  console.log("[seed] Inserted default user preferences");

  await closeDB();
  console.log("[seed] Done!");
}

seed().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
