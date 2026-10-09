import { motion } from "motion/react";
import { Blocks, Database, EyeOff, Fingerprint, KeyRound, Lock, Server, ShieldCheck, Users } from "lucide-react";
import { PageHero } from "./PageHero";
import { FinalCta } from "../sections/Sections";
import { fadeUp, SectionHeading, stagger } from "../shared";

const CONTROLS = [
  { icon: Users, title: "Tenant isolation", text: "Every request is scoped to a verified organization membership on the server. Other companies' records return 'not found', not 'forbidden'." },
  { icon: KeyRound, title: "Strong authentication", text: "bcrypt-hashed passwords, 15-minute access tokens held only in memory, and rotating refresh tokens in httpOnly cookies with reuse detection." },
  { icon: ShieldCheck, title: "Role-based access", text: "Owner, admin, manager, operator and viewer roles, checked by the API on every action. Admins cannot escalate themselves to owner." },
  { icon: Database, title: "Immutable history", text: "Database triggers reject any edit or deletion of lifecycle events, audit logs and verification logs." },
  { icon: Fingerprint, title: "Cryptographic integrity", text: "SHA-256 hash chains over canonical JSON, computed only by the server. Clients can never supply a hash, score or status." },
  { icon: Blocks, title: "Blockchain anchoring", text: "Write-once anchors on an EVM chain, restricted to authorized anchoring keys. Verification reads the chain back on every scan." },
  { icon: EyeOff, title: "Privacy-preserving logs", text: "IP addresses and user agents are stored only as salted one-way hashes. Consumers never create accounts." },
  { icon: Lock, title: "Abuse protection", text: "Rate limits on sign-in, verification and contact; anti-enumeration lockout for unknown QR codes; Cloudflare WAF in front." },
  { icon: Server, title: "Hardened deployment", text: "Non-root, read-only containers; TLS end to end; production refuses to start with unsafe configuration." },
];

export default function SecurityPage() {
  return (
    <>
      <PageHero docTitle="Security" eyebrow="Security" title={<>Built for adversaries, <span className="text-gradient">not just users.</span></>} description="ORIGINX assumes someone will try to rewrite history, clone an identity or peek at a competitor's data — and is designed so they can't do it quietly." />
      <section className="pb-24">
        <div className="container-x">
          <motion.div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" variants={stagger(0.06)} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            {CONTROLS.map((c) => (
              <motion.div key={c.title} variants={fadeUp} className="rounded-3xl border border-ink-200 bg-white p-7 shadow-soft">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-600">
                  <c.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 font-bold text-ink-900">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{c.text}</p>
              </motion.div>
            ))}
          </motion.div>
          <div className="mt-20 rounded-3xl border border-ink-200 bg-ink-900 p-8 text-white sm:p-12">
            <div className="[&_h2]:text-white [&_p]:text-ink-300">
              <SectionHeading align="left" eyebrow="Responsible disclosure" title="Found a vulnerability?" description="Please report it privately through our contact form with the topic 'Security'. We investigate every report and will credit researchers who disclose responsibly." />
            </div>
          </div>
        </div>
      </section>
      <FinalCta />
    </>
  );
}
