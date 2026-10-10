"use client";

import { useEffect, useRef, useState } from "react";
import FoxHead from "./FoxHead";

export default function Loader() {
  const [done, setDone] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setTimeout(() => setDone(true), 0);
      return;
    }

    let cancelled = false;
    const run = async () => {
      const { gsap } = await import("gsap");
      if (cancelled) return;

      const letters = wordRef.current?.querySelectorAll("span") ?? [];
      const tl = gsap.timeline({
        onComplete: () => setDone(true),
      });

      tl.fromTo(
        frameRef.current,
        { scale: 0.6, opacity: 0, rotate: -8 },
        { scale: 1, opacity: 1, rotate: 0, duration: 0.7, ease: "back.out(1.6)" }
      )
        .fromTo(
          letters,
          { y: 60, opacity: 0, rotateX: -90 },
          {
            y: 0,
            opacity: 1,
            rotateX: 0,
            duration: 0.55,
            stagger: 0.045,
            ease: "power3.out",
          },
          "-=0.25"
        )
        .to({}, { duration: 0.35 });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className={`loader ${done ? "loader_done" : ""}`}
      aria-hidden={done}
    >
      <div className="flex flex-col items-center gap-6">
        <div ref={frameRef} className="opacity-0">
          <FoxHead className="w-28 h-28 md:w-36 md:h-36" />
        </div>
        <span
          ref={wordRef}
          className="font-poly font-black text-4xl md:text-6xl tracking-tight text-ink flex"
          aria-label="MetaMask"
        >
          {"MetaMask".split("").map((ch, i) => (
            <span key={i} className="inline-block opacity-0">
              {ch}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}