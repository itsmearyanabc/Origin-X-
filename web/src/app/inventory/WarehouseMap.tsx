import { useMemo } from "react";
import type { Warehouse } from "@/lib/types";

const W = 1000;
const H = 420;
const clampLat = (lat: number) => Math.max(-85, Math.min(85, lat));
function project(lat: number, lon: number, zoom: number) {
  const size = 256 * 2 ** zoom;
  const sin = Math.sin((clampLat(lat) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}
function unproject(x: number, y: number, zoom: number) {
  const size = 256 * 2 ** zoom;
  const lon = (x / size) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  return { latitude: Number(lat.toFixed(6)), longitude: Number(lon.toFixed(6)) };
}

/** Human-driven OSM map: fetches only tiles visible in this viewport, with click-to-place support. */
export function WarehouseMap({ warehouses, onPick, selected }: { warehouses: Array<Warehouse & { organization?: { name: string } }>; onPick?: (point: { latitude: number; longitude: number }) => void; selected?: { latitude: number; longitude: number } | null }) {
  const points = warehouses.filter((w) => Number.isFinite(w.latitude) && Number.isFinite(w.longitude));
  const scene = useMemo(() => {
    const coords = [...points.map((p) => ({ latitude: p.latitude!, longitude: p.longitude! })), ...(selected ? [selected] : [])];
    const center = coords.length ? { latitude: coords.reduce((sum, p) => sum + p.latitude, 0) / coords.length, longitude: coords.reduce((sum, p) => sum + p.longitude, 0) / coords.length } : { latitude: 22.5, longitude: 79 };
    let zoom = 5;
    if (coords.length > 1) {
      zoom = 1;
      for (let z = 8; z >= 1; z--) {
        const projected = coords.map((p) => project(p.latitude, p.longitude, z));
        const xs = projected.map((p) => p.x); const ys = projected.map((p) => p.y);
        if (Math.max(...xs) - Math.min(...xs) < W * 0.76 && Math.max(...ys) - Math.min(...ys) < H * 0.72) { zoom = z; break; }
      }
    }
    const c = project(center.latitude, center.longitude, zoom);
    const left = c.x - W / 2; const top = c.y - H / 2;
    const minX = Math.floor(left / 256); const maxX = Math.floor((left + W) / 256);
    const minY = Math.max(0, Math.floor(top / 256)); const maxY = Math.min(2 ** zoom - 1, Math.floor((top + H) / 256));
    const tiles = [];
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const wrappedX = ((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom;
      tiles.push({ key: `${zoom}-${wrappedX}-${y}`, url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`, x: x * 256 - left, y: y * 256 - top });
    }
    return { zoom, left, top, tiles };
  }, [points, selected]);
  const markers = points.map((warehouse) => {
    const p = project(warehouse.latitude!, warehouse.longitude!, scene.zoom);
    return { warehouse, x: p.x - scene.left, y: p.y - scene.top };
  });
  const pick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W + scene.left;
    const y = ((event.clientY - rect.top) / rect.height) * H + scene.top;
    onPick(unproject(x, y, scene.zoom));
  };
  const selectedXY = selected ? project(selected.latitude, selected.longitude, scene.zoom) : null;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#e8eee8]">
      <svg viewBox={`0 0 ${W} ${H}`} role={onPick ? "button" : "img"} aria-label={onPick ? "Click the map to choose warehouse coordinates" : "Map showing warehouse locations"} onClick={pick} className={`block h-auto w-full ${onPick ? "cursor-crosshair" : ""}`}>
        {scene.tiles.map((tile) => <image key={tile.key} href={tile.url} x={tile.x} y={tile.y} width="256" height="256" />)}
        {markers.map(({ warehouse, x, y }) => <g key={warehouse.id} className="warehouse-map-pin" transform={`translate(${x} ${y})`}>
          <circle r="17" fill="#f25c05" opacity=".2" className="warehouse-map-pulse" />
          <circle r="9" fill="#f25c05" stroke="white" strokeWidth="3" />
          <title>{warehouse.organization?.name ? `${warehouse.organization.name} · ` : ""}{warehouse.name} · {warehouse.city || `${warehouse.latitude}, ${warehouse.longitude}`}</title>
          <text x="13" y="-12" fill="#172033" stroke="white" strokeWidth="4" paintOrder="stroke" fontSize="13" fontWeight="700">{warehouse.organization ? `${warehouse.organization.name.slice(0, 12)} · ` : ""}{warehouse.code}</text>
        </g>)}
        {selectedXY && <g transform={`translate(${selectedXY.x - scene.left} ${selectedXY.y - scene.top})`}><circle r="13" fill="#2563eb" stroke="white" strokeWidth="4" /><circle r="22" fill="#2563eb" opacity=".2" className="warehouse-map-pulse" /></g>}
      </svg>
      <div className="flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-2 text-[11px] text-muted">
        <span>{onPick ? "Click anywhere on the map to pin this warehouse" : `${markers.length} mapped site${markers.length === 1 ? "" : "s"}${warehouses.length > markers.length ? ` · ${warehouses.length - markers.length} without coordinates` : ""}`}</span>
        <a className="shrink-0 underline decoration-dotted underline-offset-2" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      </div>
      <style>{`@keyframes warehouseMapPulse{0%,100%{opacity:.22;transform:scale(.78)}50%{opacity:.04;transform:scale(1.65)}}.warehouse-map-pulse{transform-box:fill-box;transform-origin:center;animation:warehouseMapPulse 2.2s ease-in-out infinite}@media(prefers-reduced-motion:reduce){.warehouse-map-pulse{animation:none}}`}</style>
    </div>
  );
}
