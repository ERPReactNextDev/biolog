"use client";

/* ============================================================================
   components/manual-location-picker.tsx
   ----------------------------------------------------------------------------
   The "Set manually" map. Three things it now shows that it did not before:

     1. An ACCURACY CIRCLE — radius = coords.accuracy, mint, semi-transparent.
        This is the single most useful thing on the map: it visualises how much
        to trust the pin instead of implying a precision the fix does not have.

     2. A LAYER TOGGLE — OSM streets (default) or Esri World Imagery, so an
        agent standing in a building can see the roof they are under.

     3. A GEOFENCE — the client site's radius, drawn as a hard boundary. The
        drag and click clamps now use THIS rather than a fixed 1500 m, so the
        map cannot be used to place a pin outside a boundary the server will
        flag anyway.

   BACKWARD COMPATIBILITY IS DELIBERATE
   clock-drawer.tsx and both attendance sheets call this with only
   latitude/longitude/onChange. Every new prop is optional and the clamp falls
   back to the previous 1500 m in that case, so no existing call site changes
   behaviour until it opts in.
   ========================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMapEvents,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { toast } from "sonner";
import { Loader2, MapPin, Layers, Search, Crosshair } from "lucide-react";
import "leaflet/dist/leaflet.css";
import {
  MAP_LAYERS,
  MapLayer,
  coordsLabel,
  geocodeAddress,
  reverseGeocode,
} from "@/lib/geo";

/* ================= TYPES ================= */

export interface PickerFence {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  label?: string;
}

interface ManualLocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  /** Legacy fixed clamp. Kept so the old call sites behave exactly as before. */
  radiusMeters?: number;
  /**
   * Hard clamp for click + drag. Pass a fence's radius, or null to allow
   * anywhere. Falls back to `radiusMeters ?? 1500` when omitted entirely.
   */
  clampRadiusMeters?: number | null;
  /** Draws the mint accuracy circle. */
  accuracyMeters?: number | null;
  /** Draws the client-site boundary and clamps to it. */
  fence?: PickerFence | null;
  /** Tile layer to start on. */
  initialLayer?: MapLayer;
  /** Allow the address search box. Off when no geocoder token is configured. */
  allowSearch?: boolean;
  onChange: (lat: number, lng: number, address?: string) => void;
}

/* ================= LEAFLET ICON FIX ================= */

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

/* ================= HELPERS ================= */

const MINT = "#0D9669";

function distanceInMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
}

/* ================= MAP HELPERS ================= */

/**
 * Moves the viewport when a NEW GPS fix arrives (e.g. the agent pressed
 * Retry). MapContainer's `center` prop only applies on mount, so without this
 * the map would stay frozen on the first fix and the pin would drift off
 * screen — which reads as "the pin is wrong" when it is the map that is.
 */
function Recenter({ position, zoom }: { position: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(position, zoom ?? map.getZoom(), { animate: true });
  }, [map, position[0], position[1], zoom]);
  return null;
}

/** Keeps Leaflet's own +/- and attribution from being covered by our chrome. */
function MapReady({ onReady }: { onReady?: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    onReady?.();
    // invalidateSize again once tiles/layout settle — a Leaflet map inside a
    // portaled drawer very often measures 0x0 on first paint.
    const t = setTimeout(() => map.invalidateSize(), 220);
    return () => clearTimeout(t);
  }, [map, onReady]);
  return null;
}

/* ================= CLICK HANDLER ================= */

function ClickHandler({
  center,
  radius,
  onPick,
}: {
  center: [number, number] | null;
  radius: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (radius == null || !center) {
        onPick(e.latlng.lat, e.latlng.lng);
        return;
      }
      const d = distanceInMeters(center[0], center[1], e.latlng.lat, e.latlng.lng);
      if (d <= radius) onPick(e.latlng.lat, e.latlng.lng);
      else toast.error(`Pin must stay inside the ${radius} m boundary.`);
    },
  });
  return null;
}

/* ================= LOCATE ME BUTTON ================= */

function LocateMeButton({
  onLocate,
}: {
  onLocate: (lat: number, lng: number, accuracyM: number | null) => void;
}) {
  const map = useMap();
  const [locating, setLocating] = useState(false);

  const handleLocate = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        map.setView([coords.latitude, coords.longitude], 17, { animate: true });
        onLocate(
          coords.latitude,
          coords.longitude,
          typeof coords.accuracy === "number" ? coords.accuracy : null
        );
        setLocating(false);
      },
      () => {
        toast.error("Unable to get your location.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  return (
    <button
      type="button"
      onClick={handleLocate}
      className="absolute top-2.5 right-2.5 z-[1000] flex items-center gap-1.5 rounded-full px-3.5 min-h-[40px] text-[12px] font-extrabold shadow-lg transition-transform active:scale-95"
      style={{ background: "var(--mint-btn)", color: "white", boxShadow: "var(--sh-btn)" }}
    >
      {locating ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Crosshair size={14} />
      )}
      My location
    </button>
  );
}

/* ================= LAYER TOGGLE ================= */

function LayerToggle({
  layer,
  onChange,
}: {
  layer: MapLayer;
  onChange: (l: MapLayer) => void;
}) {
  return (
    <div
      className="absolute top-2.5 left-2.5 z-[1000] flex items-center gap-1 rounded-full p-1 shadow-lg"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <Layers size={13} className="ml-1.5" style={{ color: "var(--text-faint)" }} />
      {(Object.keys(MAP_LAYERS) as MapLayer[]).map((k) => {
        const active = layer === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            aria-pressed={active}
            className="min-h-[32px] px-2.5 rounded-full text-[11px] font-extrabold transition-all active:scale-95"
            style={{
              background: active ? "var(--mint-btn)" : "transparent",
              color: active ? "#fff" : "var(--text-muted)",
            }}
          >
            {MAP_LAYERS[k].label}
          </button>
        );
      })}
    </div>
  );
}

/* ================= MAIN COMPONENT ================= */

export default function ManualLocationPicker({
  latitude,
  longitude,
  radiusMeters,
  clampRadiusMeters,
  accuracyMeters = null,
  fence = null,
  initialLayer = "streets",
  allowSearch = true,
  onChange,
}: ManualLocationPickerProps) {
  /* The GPS fix and the pin are separate things. The accuracy circle belongs
     to the FIX (it describes the radio's confidence) and the draggable marker
     to the agent's chosen point. Collapsing them into one marker is what made
     the original confusing: moving the pin visually moved the error circle. */
  const gpsCenter: [number, number] | null =
    latitude != null && longitude != null ? [latitude, longitude] : null;

  const [position, setPosition] = useState<[number, number] | null>(gpsCenter);
  const [layer, setLayer] = useState<MapLayer>(initialLayer);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  /* Adopt a fresh fix — but only while the agent has not moved the pin
     themselves, so a Retry does not silently discard their correction. */
  const userMoved = useRef(false);
  useEffect(() => {
    if (!gpsCenter) return;
    if (!userMoved.current) setPosition(gpsCenter);
  }, [gpsCenter?.[0], gpsCenter?.[1]]);

  /* Clamp precedence: explicit clamp > fence > legacy radius > 1500. */
  const clamp: number | null = useMemo(() => {
    if (clampRadiusMeters !== undefined) return clampRadiusMeters;
    if (fence) return fence.radiusMeters;
    return radiusMeters ?? 1500;
  }, [clampRadiusMeters, fence, radiusMeters]);

  const fenceCenter: [number, number] | null = fence
    ? [fence.centerLat, fence.centerLng]
    : null;

  const updateLocation = async (lat: number, lng: number) => {
    setPosition([lat, lng]);
    const res = await reverseGeocode(lat, lng);
    onChange(lat, lng, res.address ?? coordsLabel(lat, lng));
  };

  const onSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    const fix = await geocodeAddress(q);
    setSearching(false);
    if (!fix) {
      toast.error(
        "Address search needs a Mapbox token (NEXT_PUBLIC_MAPBOX_TOKEN). You can still drag the pin."
      );
      return;
    }
    userMoved.current = true;
    setPosition([fix.lat, fix.lng]);
    onChange(fix.lat, fix.lng, q);
  };

  if (!gpsCenter || !position) {
    return (
      <div
        className="rounded-[var(--r-card)] px-4 py-3 text-[12.5px] font-bold"
        style={{ background: "var(--clay-soft)", color: "var(--clay-ink)" }}
      >
        Waiting for your GPS fix — the map appears once the phone gets a location lock.
      </div>
    );
  }

  const tile = MAP_LAYERS[layer];

  return (
    <div className="w-full">
      {/* Address search — the last step of the fallback chain, after the pin drag */}
      {allowSearch && (
        <div
          className="flex items-center gap-2 px-3 h-[44px] rounded-t-[var(--r-card)] border-b-0"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <Search size={15} className="shrink-0" style={{ color: "var(--text-faint)" }} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearch();
              }
            }}
            placeholder="Or type an address…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] font-semibold"
            style={{ color: "var(--text)" }}
          />
          <button
            type="button"
            onClick={onSearch}
            disabled={searching || !query.trim()}
            aria-label="Search address"
            className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 disabled:opacity-40"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          </button>
        </div>
      )}

      <div
        className="w-full h-[260px] overflow-hidden relative"
        style={{
          borderRadius: allowSearch ? "0 0 var(--r-card) var(--r-card)" : "var(--r-card)",
          border: "1px solid var(--border)",
          borderTop: allowSearch ? "none" : "1px solid var(--border)",
        }}
      >
        <MapContainer center={gpsCenter} zoom={17} style={{ height: "100%", width: "100%" }}>
          {/* key forces a fresh tile source when the layer changes; react-leaflet
              will otherwise keep the old url and show the previous imagery. */}
          <TileLayer key={layer} attribution={tile.attribution} url={tile.url} maxZoom={tile.maxZoom} />

          <MapReady />
          <Recenter position={gpsCenter} />
          <LayerToggle layer={layer} onChange={setLayer} />
          <LocateMeButton onLocate={(lat, lng, acc) => updateLocation(lat, lng)} />

          {/* Accuracy circle — radius = coords.accuracy. Mint, semi-transparent.
              Dasharray keeps it distinguishable from the solid geofence when
              the two radii are close. */}
          {accuracyMeters != null && accuracyMeters > 0 && (
            <Circle
              center={gpsCenter}
              radius={accuracyMeters}
              pathOptions={{
                color: MINT,
                weight: 1.5,
                opacity: 0.75,
                fillColor: MINT,
                fillOpacity: 0.14,
                dashArray: "5 4",
              }}
            />
          )}

          {/* Client-site geofence */}
          {fenceCenter && fence && (
            <Circle
              center={fenceCenter}
              radius={fence.radiusMeters}
              pathOptions={{
                color: MINT,
                weight: 2,
                opacity: 0.9,
                fillColor: MINT,
                fillOpacity: 0.1,
              }}
            />
          )}

          <ClickHandler center={clamp != null ? gpsCenter : null} radius={clamp} onPick={updateLocation} />

          {/* Draggable pin */}
          <Marker
            position={position}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target as L.Marker;
                const p = marker.getLatLng();

                if (clamp != null) {
                  const origin = fenceCenter ?? gpsCenter;
                  const d = distanceInMeters(origin[0], origin[1], p.lat, p.lng);
                  if (d > clamp) {
                    // Snap back rather than accepting: a pin outside the
                    // boundary would be flagged by the server anyway, and
                    // showing it here would teach the agent that it works.
                    marker.setLatLng(position);
                    toast.error(`Pin must stay inside the ${clamp} m boundary.`);
                    return;
                  }
                }
                userMoved.current = true;
                updateLocation(p.lat, p.lng);
              },
            }}
          />
        </MapContainer>
      </div>

      <div
        className="text-[11px] font-bold px-3 py-2 border-t"
        style={{
          background: "var(--bg)",
          color: "var(--text-muted)",
          borderColor: "var(--border)",
          borderRadius: "0 0 var(--r-card) var(--r-card)",
        }}
      >
        <span className="flex items-start gap-1.5">
          <MapPin size={12} className="mt-0.5 shrink-0" />
          <span>
            Drag the pin or tap the map to fine-tune.
            {clamp != null ? (
              <>
                {" "}
                It must stay within{" "}
                {fence ? (
                  <strong>{fence.radiusMeters} m of {fence.label || "the site"}</strong>
                ) : (
                  <strong>{clamp} m</strong>
                )}
                .
              </>
            ) : (
              " You can place it anywhere."
            )}
            {accuracyMeters != null && accuracyMeters > 0 && (
              <>
                {" "}
                The dashed circle is your GPS accuracy (±{Math.round(accuracyMeters)} m).
              </>
            )}
          </span>
        </span>
      </div>
    </div>
  );
}