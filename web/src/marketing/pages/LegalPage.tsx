import { Link } from "react-router";
import { PageHero } from "./PageHero";
import { cn } from "@/lib/format";

/*
 * Legal texts describe how ORIGINX actually processes data. Bracketed placeholders ([COMPANY NAME],
 * [CONTACT EMAIL], [COUNTRY], [DATE]) must be completed, and the documents reviewed by a qualified
 * lawyer, before production use.
 */

type Section = { heading: string; body: Array<string | string[]> };
type Doc = { title: string; eyebrow: string; intro: string; sections: Section[] };

const COMPANY = "[COMPANY NAME]";
const EMAIL = "[CONTACT EMAIL]";
const COUNTRY = "[COUNTRY]";

const DOCS: Record<"privacy" | "terms" | "cookies", Doc> = {
  privacy: {
    title: "Privacy policy",
    eyebrow: "Legal",
    intro: `This policy explains what personal data ${COMPANY} ("ORIGINX", "we") collects when you use the ORIGINX website, the organization and administration panels, and the public product-verification pages, and how we protect it.`,
    sections: [
      {
        heading: "1. Who we are",
        body: [`ORIGINX is operated by ${COMPANY}, registered in ${COUNTRY}. For any privacy question or request, contact ${EMAIL}.`],
      },
      {
        heading: "2. Data we collect",
        body: [
          "Account data — for people who sign in to the organization or admin panels:",
          ["Name, email address and a bcrypt hash of your password (we never store your password itself).", "Your organization memberships and roles.", "Sign-in timestamps and security events (for example failed sign-in attempts)."],
          "Organization data — entered by organizations about themselves and their products: organization profile, product and batch details, lifecycle events, custody transfers, incidents and recalls.",
          "Verification data — when anyone verifies a product, we record the time, the result, and a salted one-way hash of the IP address and browser user agent. We do not store raw IP addresses, and consumers do not create accounts.",
          "Contact form data — the name, email, company and message you send us.",
        ],
      },
      {
        heading: "3. How we use data",
        body: [
          [
            "To provide the service: authenticate users, isolate each organization's data, record and verify product history.",
            "To keep the platform secure: rate limiting, detecting abuse, cloned QR codes and counterfeit registrations, and maintaining an audit trail.",
            "To respond to your messages and requests.",
            "To meet legal obligations.",
          ],
          "We do not sell personal data and we do not use it for advertising.",
        ],
      },
      {
        heading: "4. Blockchain proofs",
        body: [
          "ORIGINX anchors cryptographic proofs on a public blockchain. Only 32-byte hashes are written — the product identity hash, event hashes and status changes such as recalls. No names, email addresses, organization details, documents or other personal data are written to the blockchain.",
          "Blockchain records are permanent by design and cannot be deleted by anyone, including us. Because they contain no personal data, deleting your account does not require changes on-chain.",
        ],
      },
      {
        heading: "5. Sharing and processors",
        body: [
          "Organization data is visible only to members of that organization, and to supply-chain partners for products they have handled. The public verification page shows only approved, non-sensitive product information.",
          "We use these service providers to run ORIGINX:",
          ["Supabase — managed PostgreSQL database hosting.", "Cloudflare — network security, DDoS protection and content delivery.", "Our hosting provider for application servers.", "A blockchain network for proof anchoring (hashes only)."],
          "If you use the optional ASK ORIGINX assistant and it is enabled for your organization, verified product facts (not personal data) are sent to our AI provider to generate an explanation.",
        ],
      },
      {
        heading: "6. Retention",
        body: [
          "Account data is kept while your account is active and for a limited period afterwards for security and legal purposes. Product history, audit logs and verification logs are append-only integrity records and are retained for as long as the organization uses ORIGINX and as required by law. Contact form messages are kept for up to [RETENTION PERIOD].",
        ],
      },
      {
        heading: "7. Security",
        body: [
          "We protect data with encryption in transit, hashed passwords and tokens, strict tenant isolation, role-based access, database-enforced immutability of history, rate limiting and audit logging. See our Security page for details.",
        ],
      },
      {
        heading: "8. Your rights",
        body: [
          `Depending on where you live, you may have the right to access, correct, delete or export your personal data, to object to or restrict processing, and to complain to a data-protection authority. To exercise these rights, contact ${EMAIL}. Some records (for example audit and product-history entries) may be retained where needed to keep the integrity record accurate or to meet legal obligations.`,
        ],
      },
      {
        heading: "9. Changes",
        body: ["We will post updates to this policy on this page and, for significant changes, notify account holders by email."],
      },
    ],
  },
  terms: {
    title: "Terms of service",
    eyebrow: "Legal",
    intro: `These terms govern use of ORIGINX, provided by ${COMPANY}. By creating an account or using the service you agree to them.`,
    sections: [
      { heading: "1. The service", body: ["ORIGINX provides Digital Product Passports, tamper-evident lifecycle records, custody transfers between organizations, blockchain-anchored proofs, trust scoring, incident and recall management, and public product verification."] },
      {
        heading: "2. Accounts and organizations",
        body: [
          [
            "You must provide accurate information and keep your credentials confidential.",
            "Organizations are reviewed and may be approved, verified, suspended or rejected by ORIGINX.",
            "Organization owners are responsible for the people they invite and the roles they grant.",
          ],
        ],
      },
      {
        heading: "3. Your data and responsibilities",
        body: [
          "You keep ownership of the data you submit. You grant us the rights needed to store, process, verify and display it as part of the service, including showing the public passport information for your products to anyone who scans them.",
          "You are responsible for the accuracy of the events and information you record. ORIGINX verifies the integrity of records — that they have not been altered after being recorded — not the truth of what was originally entered.",
        ],
      },
      {
        heading: "4. Acceptable use",
        body: [
          [
            "Do not register product identities you are not entitled to, or attempt to impersonate another organization.",
            "Do not attempt to tamper with records, bypass security controls, probe other tenants' data or overload the service.",
            "Do not use ORIGINX for unlawful purposes.",
          ],
          "We may suspend accounts or organizations that breach these rules. Suspected counterfeit registrations are quarantined and reported to the affected organization.",
        ],
      },
      { heading: "5. Blockchain records", body: ["Proofs anchored on a blockchain are permanent and public. They contain only cryptographic hashes. You agree that such proofs cannot be removed once written."] },
      { heading: "6. Plans and fees", body: ["Paid plans are billed per organization as agreed in your order. Plan limits (products, team members) apply as described on the Pricing page."] },
      { heading: "7. Availability", body: ["We work to keep ORIGINX available and secure but do not guarantee uninterrupted service. If a blockchain network is unavailable, proofs are queued and anchored later."] },
      { heading: "8. Liability", body: [`To the extent permitted by law, ${COMPANY}'s liability is limited to the fees paid for the service in the twelve months before the claim. [LIABILITY TERMS TO BE REVIEWED BY COUNSEL]`] },
      { heading: "9. Governing law", body: [`These terms are governed by the laws of ${COUNTRY}. Contact: ${EMAIL}.`] },
    ],
  },
  cookies: {
    title: "Cookie policy",
    eyebrow: "Legal",
    intro: "ORIGINX uses as little browser storage as possible, and none of it is used for advertising or cross-site tracking.",
    sections: [
      {
        heading: "Strictly necessary cookie",
        body: [
          ["ox_rt — keeps you signed in. It is httpOnly (not readable by page scripts), Secure, restricted to our authentication endpoints, and expires after 7 days or when you sign out."],
          "This cookie is required for signed-in features and is only set when you sign in.",
        ],
      },
      {
        heading: "Local storage",
        body: [["Your selected organization and light/dark preference in the panels. These never leave your browser and are not used to identify you."]],
      },
      {
        heading: "No tracking or advertising cookies",
        body: ["We do not use analytics, advertising or social-media cookies. Public product verification works without any cookies at all."],
      },
      {
        heading: "Managing cookies",
        body: ["You can delete cookies in your browser settings at any time. Deleting the session cookie signs you out."],
      },
    ],
  },
};

export default function LegalPage({ doc }: { doc: "privacy" | "terms" | "cookies" }) {
  const d = DOCS[doc];
  return (
    <>
      <PageHero docTitle={d.title} eyebrow={d.eyebrow} title={d.title} description="Last updated: [DATE]" />
      <section className="pb-24">
        <div className="container-x grid gap-10 lg:grid-cols-[220px_1fr]">
          <nav className="hidden lg:block" aria-label="Legal documents">
            <div className="sticky top-28 space-y-1">
              {(["privacy", "terms", "cookies"] as const).map((k) => (
                <Link key={k} to={`/${k}`} className={cn("block rounded-xl px-3 py-2 text-sm font-medium transition", k === doc ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100")}>
                  {DOCS[k].title}
                </Link>
              ))}
            </div>
          </nav>
          <article className="max-w-3xl rounded-3xl border border-ink-200 bg-white p-6 shadow-soft sm:p-10">
            <p className="text-base leading-relaxed text-ink-700">{d.intro}</p>
            {d.sections.map((s) => (
              <section key={s.heading} className="mt-9">
                <h2 className="text-xl font-bold text-ink-900">{s.heading}</h2>
                <div className="mt-3 space-y-3 text-[0.95rem] leading-relaxed text-ink-700">
                  {s.body.map((b, i) =>
                    Array.isArray(b) ? (
                      <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-brand-500">
                        {b.map((li) => (
                          <li key={li}>{li}</li>
                        ))}
                      </ul>
                    ) : (
                      <p key={i}>{b}</p>
                    ),
                  )}
                </div>
              </section>
            ))}
          </article>
        </div>
      </section>
    </>
  );
}
