"use client";

import { useEffect, useRef, useState } from "react";
import ScrollHeading from "./ScrollHeading";
import PhoneMockup from "./PhoneMockup";

export type StorySlide = {
  eyebrow: string;
  title: string;
  body: string;
  bg: string;
};

export default function StickyStory({
  id,
  slides,
  accent,
  children,
}: {
  id: string;
  slides: StorySlide[];
  accent: string;
  children?: React.ReactNode;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const onScroll = () => {
      const rect = section.getBoundingClientRect();
      const total = section.offsetHeight - window.innerHeight;
      const p = Math.min(1, Math.max(0, -rect.top / total));
      const next = Math.min(slides.length - 1, Math.floor(p * slides.length));
      setStep(next);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [slides.length]);

  const slide = slides[step];

  return (
    <section
      id={id}
      ref={sectionRef}
      className="relative"
      style={{ height: `${slides.length * 100}vh` }}
    >
      <div
        className="sticky-container"
        style={{ background: slide.bg, transition: "background-color 0.7s ease" }}
      >
        <div className="sticky-wrapper max-w-7xl mx-auto px-4 md:px-8 grid lg:grid-cols-2 items-center gap-12 pt-20">
          <div key={step} className="build-up">
            <p className="type-label-eyebrow" style={{ color: accent }}>
              {slide.eyebrow}
            </p>
            <ScrollHeading className="type-display-l mt-4">{slide.title}</ScrollHeading>
            <p className="mt-5 type-body-l text-cream/70 max-w-md leading-relaxed">{slide.body}</p>
            <div className="mt-8 pagination-dots" role="tablist" aria-label="Slides">
              {slides.map((s, i) => (
                <button
                  key={s.title}
                  role="tab"
                  aria-selected={i === step}
                  aria-label={`Go to slide ${i + 1}`}
                  className={`pagination-dot ${i === step ? "pagination-dot_active" : ""}`}
                  style={{ width: i === step ? 28 : 6 }}
                  onClick={() => {
                    const section = sectionRef.current;
                    if (!section) return;
                    const total = section.offsetHeight - window.innerHeight;
                    const y = section.offsetTop + (i / slides.length) * total + 8;
                    window.scrollTo({ top: y, behavior: "smooth" });
                  }}
                />
              ))}
            </div>
          </div>

          <div className="hidden lg:flex justify-center items-center relative">
            {children ?? <PhoneMockup />}
          </div>
        </div>
      </div>
    </section>
  );
}