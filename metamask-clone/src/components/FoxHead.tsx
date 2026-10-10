"use client";

import { useEffect, useRef } from "react";

export default function FoxHead({
  className = "",
  animated = false,
  size = 400,
}: {
  className?: string;
  animated?: boolean;
  size?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!animated || !ref.current) return;
    const el = ref.current;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 8;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 8;
      el.style.transform = `translate(${x}px, ${y}px)`;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [animated]);

  return (
    <svg
      ref={ref}
      viewBox="0 0 400 380"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Fox mascot"
      style={{ transformOrigin: "center center" }}
    >
      <defs>
        <linearGradient id="foxGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd6a5" />
          <stop offset="40%" stopColor="#f6851b" />
          <stop offset="100%" stopColor="#e2761b" />
        </linearGradient>
        <linearGradient id="foxGradDark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6851b" />
          <stop offset="100%" stopColor="#c14d00" />
        </linearGradient>
        <filter id="innerGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* ears */}
      <path d="M60 40 L150 120 L95 165 Z" fill="url(#foxGradDark)" />
      <path d="M340 40 L250 120 L305 165 Z" fill="url(#foxGradDark)" />
      <path d="M78 62 L148 122 L108 152 Z" fill="#ffd6a5" opacity="0.85" />
      <path d="M322 62 L252 122 L292 152 Z" fill="#ffd6a5" opacity="0.85" />
      {/* face */}
      <path
        d="M200 90
           C 280 90, 345 145, 340 215
           C 336 285, 285 350, 200 368
           C 115 350, 64 285, 60 215
           C 55 145, 120 90, 200 90 Z"
        fill="url(#foxGrad)"
        filter="url(#innerGlow)"
      />
      {/* muzzle */}
      <path
        d="M200 250 C 245 250, 275 275, 270 305 C 266 335, 235 360, 200 368 C 165 360, 134 335, 130 305 C 125 275, 155 250, 200 250 Z"
        fill="#fffcf5"
      />
      {/* eyes */}
      <g className={animated ? "fox-eye" : undefined} style={{ transformOrigin: "148px 210px" }}>
        <ellipse cx="148" cy="210" rx="22" ry="26" fill="#101010" />
        <ellipse cx="154" cy="202" rx="7" ry="8" fill="#fffcf5" />
      </g>
      <g className={animated ? "fox-eye" : undefined} style={{ transformOrigin: "252px 210px" }}>
        <ellipse cx="252" cy="210" rx="22" ry="26" fill="#101010" />
        <ellipse cx="258" cy="202" rx="7" ry="8" fill="#fffcf5" />
      </g>
      {/* nose */}
      <ellipse cx="200" cy="296" rx="18" ry="13" fill="#101010" />
      <path
        d="M200 309 C 200 325, 180 330, 168 322"
        stroke="#101010"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M200 309 C 200 325, 220 330, 232 322"
        stroke="#101010"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}