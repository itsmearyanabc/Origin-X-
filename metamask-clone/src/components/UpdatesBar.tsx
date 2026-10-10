"use client";

export default function UpdatesBar() {
  const items = [
    "UPDATE — Win a share of $20K in the security challenge",
    "NEW — mUSD yield is live for all users",
    "MetaMask Card waitlist is open",
    "Snaps directory passes 200 extensions",
  ];

  return (
    <div
      className="relative bg-ink text-cream build-up overflow-hidden"
      style={{ animationDelay: "0.7s" }}
    >
      <div className="marquee-track py-2.5 type-label">
        {[0, 1].map((dup) => (
          <div className="marquee-group" key={dup} aria-hidden={dup === 1}>
            {items.map((item) => (
              <span key={item} className="whitespace-nowrap flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}