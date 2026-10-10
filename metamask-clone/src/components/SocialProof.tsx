import Reveal from "./Reveal";

const CARDS = [
  {
    quote: "MetaMask is the first wallet I recommend to anyone entering crypto.",
    author: "Onchain newsletter",
    shape: "shape-clip-1",
    bg: "bg-purple-light",
  },
  {
    quote: "The gold standard for self-custody since 2016.",
    author: "Dev forum roundup",
    shape: "shape-clip-2",
    bg: "bg-blue-light",
  },
  {
    quote: "Thirty million people can't all be wrong.",
    author: "Industry report",
    shape: "shape-clip-3",
    bg: "bg-green-light",
  },
];

export default function SocialProof() {
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {CARDS.map((card, i) => (
        <Reveal key={card.author} delay={i * 120}>
          <article className={`relative ${card.bg} rounded-3xl p-8 min-h-[280px] flex flex-col justify-between overflow-hidden`}>
            <div
              className={`absolute inset-0 ${card.shape} bg-white/30`}
              aria-hidden
            />
            <blockquote className="relative font-poly type-heading-m font-bold leading-snug text-ink">
              “{card.quote}”
            </blockquote>
            <p className="relative type-label-eyebrow text-ink/40">{card.author}</p>
          </article>
        </Reveal>
      ))}
    </div>
  );
}