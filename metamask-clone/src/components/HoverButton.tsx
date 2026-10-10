"use client";

import { ReactNode } from "react";

export default function HoverButton({
  children,
  href = "#",
  variant = "dark",
  className = "",
}: {
  children: ReactNode;
  href?: string;
  variant?: "dark" | "light" | "brand" | "ghost";
  className?: string;
}) {
  return (
    <a href={href} className={`button-group btn-${variant} ${className}`}>
      <span className="button-holder">
        <span className="button-main">
          {children}
          <svg className="button-icon-hover w-4 h-4" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="button-hover" aria-hidden>
          {children}
          <svg className="button-icon-hover w-4 h-4" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </span>
    </a>
  );
}