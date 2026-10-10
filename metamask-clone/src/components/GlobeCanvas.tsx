"use client";

import { useEffect, useRef } from "react";

export default function GlobeCanvas({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let angle = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const points: { lat: number; lon: number }[] = [];
    const count = 420;
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = Math.PI * (3 - Math.sqrt(5)) * i;
      points.push({ lat: Math.acos(y) - Math.PI / 2, lon: theta });
    }

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) * 0.38;
      ctx.clearRect(0, 0, w, h);

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(11, 87, 208, 0.06)";
      ctx.fill();
      ctx.strokeStyle = "rgba(11, 87, 208, 0.25)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();

      for (const p of points) {
        const lon = p.lon + angle;
        const x3 = Math.cos(p.lat) * Math.sin(lon);
        const y3 = Math.sin(p.lat);
        const z3 = Math.cos(p.lat) * Math.cos(lon);
        if (z3 < 0.05) continue;
        const sx = cx + x3 * r;
        const sy = cy - y3 * r;
        const size = (0.6 + z3 * 1.8) * dpr;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(11, 87, 208, ${0.25 + z3 * 0.6})`;
        ctx.fill();
      }

      angle += 0.0035;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}