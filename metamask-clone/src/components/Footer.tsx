import FoxHead from "./FoxHead";
import HoverButton from "./HoverButton";

const COLUMNS = [
  {
    title: "Products",
    links: ["Extension", "Mobile", "Portfolio", "Card", "mUSD", "Swaps"],
  },
  {
    title: "Developer",
    links: ["SDK", "Snaps", "Delegation Toolkit", "Embedded Wallets", "Docs"],
  },
  {
    title: "Company",
    links: ["About", "Careers", "News", "Press", "Brand kit"],
  },
  {
    title: "Support",
    links: ["Help center", "Community", "Status", "Security", "Contact"],
  },
];

export default function Footer() {
  return (
    <footer className="relative bg-ink text-cream pt-24 pb-12 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        <div className="grid lg:grid-cols-[1fr_auto] gap-12 items-end">
          <h2 className="font-poly font-black type-display-xl">
            Your home
            <br />
            in web3
          </h2>
          <div className="fox-float self-end" aria-hidden>
            <FoxHead className="w-40 h-40 md:w-56 md:h-56" animated size={560} />
          </div>
        </div>

        <div className="mt-16 flex flex-wrap gap-3">
          <HoverButton variant="brand">Download MetaMask</HoverButton>
          <HoverButton variant="light">Get support</HoverButton>
        </div>

        <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-10 border-t border-cream/10 pt-12">
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="type-label-eyebrow text-cream/40 mb-4">{col.title}</p>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link}>
                    <a href="#" className="type-body-s text-cream/80 hover:text-brand transition-colors">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-cream/10 flex flex-col md:flex-row gap-4 justify-between type-caption text-cream/40">
          <p>Recreation of metamask.io for educational purposes. Not affiliated with Consensys.</p>
          <p className="font-sans-mono">Built with Next.js · GSAP · Lenis</p>
        </div>
      </div>
    </footer>
  );
}