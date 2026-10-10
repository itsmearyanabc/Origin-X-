import FoxHead from "./FoxHead";

export default function FlipCard() {
  return (
    <div className="flip-card w-full max-w-sm h-[340px]" tabIndex={0} aria-label="mUSD coin, hover to flip">
      <div className="flip-card-inner">
        <div className="flip-face bg-orange-light">
          <div className="flex items-center justify-between">
            <span className="type-label-eyebrow text-orange-dark">mUSD</span>
            <FoxHead className="w-10 h-10" size={200} />
          </div>
          <div>
            <p className="font-poly text-6xl font-black text-orange-dark">$1.00</p>
            <p className="mt-2 text-sm font-semibold text-ink/60">
              Hover to flip · A dollar that earns
            </p>
          </div>
        </div>
        <div className="flip-face flip-back bg-ink text-cream">
          <span className="type-label-eyebrow text-brand">Under the hood</span>
          <div>
            <p className="font-poly type-heading-xl font-black leading-tight">
              Yield routed to you, automatically.
            </p>
            <p className="mt-3 text-sm text-cream/70">
              Backed by tokenized treasuries. Spend it, swap it, or let it
              compound — your call.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}