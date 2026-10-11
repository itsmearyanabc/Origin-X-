import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Warehouse } from "@/lib/types";

/**
 * Interactive warehouse map: MapLibre GL (open source) with OpenFreeMap vector tiles — no API key,
 * account or usage fees. Drag to pan, Ctrl/⌘ + scroll (two fingers on phones) to zoom, click a pin
 * for details. With `onPick` it becomes a location picker: click, drag the pin, or search a place.
 */
type Point = { latitude: number; longitude: number };
type MappedWarehouse = Warehouse & { organization?: { name: string } };
type MapLibre = typeof import("maplibre-gl");

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Used if OpenFreeMap is unreachable: plain OpenStreetMap raster tiles.
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};
const INDIA: Point = { latitude: 22.5, longitude: 79 };
const round = (n: number) => Number(n.toFixed(6));

let libLoad: Promise<MapLibre> | null = null;
function loadMapLibre(): Promise<MapLibre> {
  // Loaded on first use so the ~1 MB map engine stays out of every other page's bundle.
  libLoad ??= Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url")]).then(([lib, worker]) => {
    lib.setWorkerUrl(worker.default);
    return lib;
  });
  return libLoad;
}

let styleLoad: Promise<StyleSpecification> | null = null;
function loadStyle(): Promise<StyleSpecification> {
  styleLoad ??= fetch(STYLE_URL)
    .then((r) => (r.ok ? (r.json() as Promise<StyleSpecification>) : Promise.reject(new Error(`style ${r.status}`))))
    .then(englishLabels)
    .catch(() => {
      styleLoad = null; // try OpenFreeMap again next time
      return FALLBACK_STYLE;
    });
  return styleLoad;
}

/** Place names in English (falling back to the local name) instead of "Delhi दिल्ली" pairs. */
function englishLabels(style: StyleSpecification): StyleSpecification {
  const name = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name:latin"], ["get", "name"]];
  for (const layer of style.layers) {
    const layout = (layer as { layout?: Record<string, unknown> }).layout;
    if (layout?.["text-field"] && JSON.stringify(layout["text-field"]).includes('"name')) layout["text-field"] = name;
  }
  return style;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text; // textContent, never innerHTML: names come from users
  return node;
}

function pinElement(w: MappedWarehouse) {
  const pin = el("div", "wm-pin");
  pin.append(el("span", "wm-pulse"), el("span", "wm-dot"), el("span", "wm-label", `${w.organization ? `${w.organization.name.slice(0, 14)} · ` : ""}${w.code}`));
  pin.setAttribute("aria-label", `${w.name} (${w.code})`);
  return pin;
}

function popupContent(w: MappedWarehouse) {
  const box = el("div", "wm-popup");
  if (w.organization?.name) box.append(el("p", "wm-popup-org", w.organization.name));
  box.append(el("p", "wm-popup-name", w.name));
  const place = [w.address, w.city, w.country].filter(Boolean).join(", ") || `${w.latitude}, ${w.longitude}`;
  box.append(el("p", "wm-popup-meta", `${w.code} · ${place}`));
  if (w.status) box.append(el("p", `wm-popup-status ${w.status === "ACTIVE" ? "is-active" : ""}`, w.status.charAt(0) + w.status.slice(1).toLowerCase()));
  return box;
}

export function WarehouseMap({ warehouses, onPick, selected }: { warehouses: MappedWarehouse[]; onPick?: (point: Point) => void; selected?: Point | null }) {
  const container = useRef<HTMLDivElement>(null);
  const lib = useRef<MapLibre | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const selectedMarker = useRef<Marker | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const initialSelected = useRef(selected);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const points = useMemo(() => warehouses.filter((w) => Number.isFinite(w.latitude) && Number.isFinite(w.longitude)), [warehouses]);
  // Re-fit only when the set of mapped sites really changes, not on every parent render.
  const pointsKey = points.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join("|");

  useEffect(() => {
    let cancelled = false;
    let instance: MapLibreMap | null = null;
    Promise.all([loadMapLibre(), loadStyle()])
      .then(([maplibre, style]) => {
        if (cancelled || !container.current) return;
        const start = initialSelected.current ?? INDIA;
        instance = new maplibre.Map({
          container: container.current,
          style,
          center: [start.longitude, start.latitude],
          zoom: initialSelected.current ? 12 : 3.6,
          cooperativeGestures: true, // the page keeps scrolling; Ctrl/⌘ + scroll zooms the map
        });
        instance.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "top-right");
        instance.addControl(new maplibre.FullscreenControl(), "top-right");
        instance.on("click", (e) => pickRef.current?.({ latitude: round(e.lngLat.lat), longitude: round(e.lngLat.lng) }));
        if (pickRef.current) instance.getCanvas().style.cursor = "crosshair";
        lib.current = maplibre;
        map.current = instance;
        setReady(true);
      })
      .catch(() => !cancelled && setFailed(true)); // e.g. no WebGL in this browser
    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
      selectedMarker.current = null;
    };
  }, []);

  // Warehouse pins with a details popup.
  useEffect(() => {
    const maplibre = lib.current;
    const instance = map.current;
    if (!ready || !maplibre || !instance) return;
    const markers = points.map((w) =>
      new maplibre.Marker({ element: pinElement(w) })
        .setLngLat([w.longitude!, w.latitude!])
        .setPopup(new maplibre.Popup({ offset: 16, closeButton: false, maxWidth: "260px" }).setDOMContent(popupContent(w)))
        .addTo(instance),
    );
    if (points.length === 1) instance.jumpTo({ center: [points[0].longitude!, points[0].latitude!], zoom: 11 });
    else if (points.length > 1) {
      const bounds = new maplibre.LngLatBounds();
      for (const p of points) bounds.extend([p.longitude!, p.latitude!]);
      instance.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 0 });
    }
    return () => markers.forEach((m) => m.remove());
  }, [ready, pointsKey]); // pointsKey stands for points

  // The picked location: a draggable blue pin.
  useEffect(() => {
    const maplibre = lib.current;
    const instance = map.current;
    if (!ready || !maplibre || !instance) return;
    if (!selected) {
      selectedMarker.current?.remove();
      selectedMarker.current = null;
      return;
    }
    if (!selectedMarker.current) {
      selectedMarker.current = new maplibre.Marker({ color: "#2563eb", draggable: Boolean(pickRef.current) }).setLngLat([selected.longitude, selected.latitude]).addTo(instance);
      selectedMarker.current.on("dragend", () => {
        const p = selectedMarker.current!.getLngLat();
        pickRef.current?.({ latitude: round(p.lat), longitude: round(p.lng) });
      });
    } else selectedMarker.current.setLngLat([selected.longitude, selected.latitude]);
  }, [ready, selected?.latitude, selected?.longitude]);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#e8eee8]">
      {onPick && <PlaceSearch onFound={(p, exact) => {
        map.current?.flyTo({ center: [p.longitude, p.latitude], zoom: exact ? 15 : 12 });
        if (exact) onPick(p); // an approximate area only moves the map; the user clicks the spot
      }} />}
      {failed ? (
        <div className="grid h-72 place-items-center p-6 text-center text-sm text-muted sm:h-96">The map couldn't load in this browser (it needs WebGL). {onPick ? "Enter the latitude and longitude instead." : ""}</div>
      ) : (
        <div ref={container} className="h-72 w-full sm:h-96" role="region" aria-label={onPick ? "Map: click to choose the warehouse location" : "Map of warehouse locations"} />
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-2 text-[11px] text-muted">
        <span>{onPick ? "Search, click the map, or drag the blue pin to set the location" : `${points.length} mapped site${points.length === 1 ? "" : "s"}${warehouses.length > points.length ? ` · ${warehouses.length - points.length} without coordinates` : ""}`}</span>
        <span className="hidden shrink-0 sm:inline">Ctrl/⌘ + scroll to zoom</span>
      </div>
      <style>{`
        .wm-pin{position:relative;width:18px;height:18px;cursor:pointer}
        .wm-dot{position:absolute;inset:0;border-radius:9999px;background:#f25c05;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}
        .wm-pulse{position:absolute;inset:-9px;border-radius:9999px;background:#f25c05;opacity:.2;animation:wmPulse 2.2s ease-in-out infinite}
        .wm-label{position:absolute;left:22px;top:-13px;white-space:nowrap;font:700 12px/1.2 "Inter Variable",system-ui,sans-serif;color:#172033;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;pointer-events:none}
        .wm-popup{font-family:"Inter Variable",system-ui,sans-serif;color:#172033}
        .wm-popup p{margin:0}
        .wm-popup-org{font-size:11px;color:#64748b}
        .wm-popup-name{font-weight:700;font-size:13px;margin-top:1px}
        .wm-popup-meta{font-size:12px;color:#475569;margin-top:2px}
        .wm-popup-status{display:inline-block;margin-top:6px;font-size:11px;font-weight:600;border-radius:9999px;padding:1px 8px;background:#f1f5f9;color:#475569}
        .wm-popup-status.is-active{background:#dcfce7;color:#166534}
        @keyframes wmPulse{0%,100%{opacity:.22;transform:scale(.78)}50%{opacity:.04;transform:scale(1.65)}}
        @media(prefers-reduced-motion:reduce){.wm-pulse{animation:none}}
      `}</style>
    </div>
  );
}

/**
 * Place search for the picker, via OpenStreetMap's Nominatim (free, no key). Its usage policy
 * allows searches on demand but not search-as-you-type, so it runs only on Enter / the button.
 */
type Hit = { lat: string; lon: string; display_name: string };
async function geocode(q: string): Promise<Hit | undefined> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`search ${res.status}`);
  return ((await res.json()) as Hit[])[0];
}

function PlaceSearch({ onFound }: { onFound: (p: Point, exact: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const search = async () => {
    const q = query.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const hit = await geocode(q);
      const at = (h: Hit) => ({ latitude: round(Number(h.lat)), longitude: round(Number(h.lon)) });
      if (hit) {
        onFound(at(hit), true);
        setMessage(hit.display_name);
        return;
      }
      // Nominatim misses some exact wordings ("Okhla Industrial Estate, New Delhi"): show the wider
      // area instead ("New Delhi"), waiting a second first — its policy is one request per second.
      const wider = q.split(",").slice(1).join(",").trim();
      const area = wider ? await new Promise((r) => setTimeout(r, 1100)).then(() => geocode(wider)) : undefined;
      if (area) {
        onFound(at(area), false);
        setMessage(`Couldn't find that exact address — showing ${area.display_name}. Click the exact spot on the map.`);
      } else setMessage("No match — try a different spelling or a nearby city.");
    } catch {
      setMessage("Search is unavailable right now — click the map instead.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-b border-line bg-surface p-2">
      {/* Not a <form>: this sits inside the warehouse form, and Enter must search, not submit it. */}
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Search an address or place, e.g. Udyog Vihar, Gurugram"
          aria-label="Search for a place"
          className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink-900 outline-none focus:border-brand-400"
        />
        <button type="button" onClick={() => void search()} disabled={busy || query.trim().length < 3} className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Searching…" : "Search"}
        </button>
      </div>
      {message && <p className="mt-1.5 truncate px-1 text-[11px] text-muted" title={message}>{message}</p>}
    </div>
  );
}
