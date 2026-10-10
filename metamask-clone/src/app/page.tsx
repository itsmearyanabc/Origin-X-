import UpdatesBar from "@/components/UpdatesBar";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import StickyStory from "@/components/StickyStory";
import SecuritySection from "@/components/SecuritySection";
import BentoGrid from "@/components/BentoGrid";
import FlipCard from "@/components/FlipCard";
import SocialProof from "@/components/SocialProof";
import Footer from "@/components/Footer";

const TRADE_SLIDES = [
  {
    eyebrow: "Trade anything",
    title: "Best rates. No bridge required.",
    body: "Swap across 850+ networks without leaving MetaMask. We route through every major DEX and aggregator to find the price you deserve.",
    bg: "bg-purple-light",
  },
  {
    eyebrow: "Trade anything",
    title: "Perpetuals onchain, finally.",
    body: "Trade with leverage directly from your wallet. No CEX, no KYC, no custody risk — just you and the market.",
    bg: "bg-blue-light",
  },
  {
    eyebrow: "Trade anything",
    title: "Your portfolio, one tap.",
    body: "See every position across every chain. Rebalance, zap, and track PnL without switching apps.",
    bg: "bg-green-light",
  },
];

const MONEY_SLIDES = [
  {
    eyebrow: "Turn your money on",
    title: "mUSD — A dollar that earns.",
    body: "Hold a stablecoin backed by treasuries that pays you daily yield. No staking, no lockups, just value that compounds.",
    bg: "bg-orange-light",
  },
  {
    eyebrow: "Turn your money on",
    title: "Spend crypto like cash.",
    body: "The MetaMask Card lets you tap to pay anywhere Mastercard works. Your crypto converts at the register — no pre-loading.",
    bg: "bg-blue-light",
  },
  {
    eyebrow: "Turn your money on",
    title: "Rewards on every action.",
    body: "Earn cashback on swaps, bridges, and card spend. Rewards deposit straight to your wallet — no claiming required.",
    bg: "bg-purple-light",
  },
];

const SECURITY_SLIDES = [
  {
    eyebrow: "Maximum security",
    title: "Keys never leave your device.",
    body: "Your seed phrase stays encrypted on your hardware. Even we can't see it. Only you approve transactions.",
    bg: "bg-green-light",
  },
  {
    eyebrow: "Maximum security",
    title: "Smart transaction checks.",
    body: "We simulate every signature before you sign — flagging scams, drains, and phishing in real time.",
    bg: "bg-blue-light",
  },
  {
    eyebrow: "Maximum security",
    title: "Open source since 2016.",
    body: "Millions of developers audit our code. The extension is MIT-licensed and battle-tested across billions in value.",
    bg: "bg-purple-light",
  },
];

export default function Home() {
  return (
    <>
      <UpdatesBar />
      <Header />
      <main className="flex-1">
        <Hero />

        <StickyStory id="trade" slides={TRADE_SLIDES} accent="#f6851b" />

        <StickyStory id="money" slides={MONEY_SLIDES} accent="#f6851b" />

        <SecuritySection />

        <section className="section-xl bg-cream" id="features">
          <div className="max-w-7xl mx-auto px-4 md:px-8">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div>
                <p className="type-label-eyebrow text-purple-dark">New products</p>
                <h2 className="font-poly font-black type-display-m mt-4">
                  mUSD &mdash; A dollar that works for you
                </h2>
                <p className="mt-6 type-body-l text-ink/70 max-w-xl leading-relaxed">
                  The first stablecoin with native yield built in. Hold mUSD and
                  watch your balance grow daily — backed by tokenized US
                  treasuries, redeemable 1:1, always.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a href="#" className="inline-flex items-center gap-2 px-5 py-3 bg-brand text-ink rounded-full font-bold hover:bg-orange-hover transition-colors">
                    Join waitlist
                  </a>
                  <a
                    href="#"
                    className="inline-flex items-center gap-2 px-5 py-3 border border-ink/15 text-ink rounded-full font-bold hover:bg-ink/5 transition-colors"
                  >
                    Read the docs
                  </a>
                </div>
              </div>
              <FlipCard />
            </div>

            <div className="mt-24">
              <p className="type-label-eyebrow text-ink/40 mb-4">Trusted by millions</p>
              <SocialProof />
            </div>
          </div>
        </section>

        <section className="section-xl bg-purple-light" id="bento">
          <div className="max-w-7xl mx-auto px-4 md:px-8">
            <p className="type-label-eyebrow text-purple-dark">Everything in one place</p>
            <h2 className="font-poly font-black type-display-m mt-4">
              Your web3 dashboard, your way
            </h2>
            <p className="mt-5 type-body-l text-ink/70 max-w-2xl">
              Scroll to expand cards. Swap, spend, earn, and build — all from
              the same interface.
            </p>
            <div className="mt-12">
              <BentoGrid />
            </div>
          </div>
        </section>

        <section className="section-xl bg-cream" id="newsletter">
          <div className="max-w-3xl mx-auto px-4 md:px-8 text-center">
            <p className="type-label-eyebrow text-ink/40">Stay in the loop</p>
            <h2 className="font-poly font-black type-display-m mt-4">
              Get the latest from MetaMask
            </h2>
            <p className="mt-5 type-body-l text-ink/70">
              Product updates, security alerts, and ecosystem news — straight to
              your inbox.
            </p>
            <form className="mt-8 flex flex-col sm:flex-row gap-3 justify-center" action="#">
              <label htmlFor="email" className="sr-only">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@domain.com"
                required
                className="flex-1 max-w-md px-5 py-3 rounded-full border border-ink/15 bg-white text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <button
                type="submit"
                className="px-7 py-3 bg-ink text-cream rounded-full font-bold hover:bg-brand transition-colors whitespace-nowrap"
              >
                Subscribe
              </button>
            </form>
            <p className="mt-4 type-caption text-ink/40">
              By subscribing you agree to our{" "}
              <a href="#" className="underline hover:text-brand">Privacy Policy</a>
              . No spam, unsubscribe anytime.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}