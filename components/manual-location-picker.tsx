"use client";

import React, { useEffect, useRef, useState } from "react";
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
import { Loader2, MapPin } from "lucide-react";
import "leaflet/dist/leaflet.css";

/* ================= TYPES ================= */

interface ManualLocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters?: number;
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

function distanceInMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
}

/* ================= CLICK HANDLER ================= */

function ClickHandler({
  center,
  radius,
  onPick,
}: {
  center: [number, number];
  radius: number;
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      const d = distanceInMeters(
        center[0],
        center[1],
        e.latlng.lat,
        e.latlng.lng
      );

      if (d <= radius) {
        onPick(e.latlng.lat, e.latlng.lng);
      } else {
        toast.error("Pin must stay inside the allowed radius.");
      }
    },
  });

  return null;
}

/* ================= LOCATE ME BUTTON ================= */

function LocateMeButton({
  onLocate,
}: {
  onLocate: (lat: number, lng: number) => void;
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
        const { latitude, longitude } = coords;
        map.setView([latitude, longitude], 17, { animate: true });
        onLocate(latitude, longitude);
        setLocating(false);
      },
      () => {
        toast.error("Unable to get your location.");
        setLocating(false);
      },
      { enableHighAccuracy: true }
    );
  };

  return (
    <button
      type="button"
      onClick={handleLocate}
      className="absolute top-2.5 right-2.5 z-[1000] flex items-center gap-1.5 rounded-full px-3.5 min-h-[40px] text-[12px] font-extrabold shadow-lg transition-transform active:scale-95"
      style={{
        background: "var(--mint-btn)",
        color: "white",
        boxShadow: "var(--sh-btn)",
      }}
    >
      {locating ? (
        <>
          <Loader2 size={13} className="animate-spin" />
          Locating…
        </>
      ) : (
        <>
          <MapPin size={13} />
          Locate me
        </>
      )}
    </button>
  );
}

/* ================= MAIN COMPONENT ================= */

export default function ManualLocationPicker({
  latitude,
  longitude,
  radiusMeters = 1500,
  onChange,
}: ManualLocationPickerProps) {
  // 🔒 Fixed GPS origin (does NOT change)
  const fixedCenterRef = useRef<[number, number] | null>(null);

  // 📍 Marker position (movable)
  const [position, setPosition] = useState<[number, number] | null>(null);

  /* Initialize fixed center ONCE */
  useEffect(() => {
    if (latitude && longitude && !fixedCenterRef.current) {
      fixedCenterRef.current = [latitude, longitude];
      setPosition([latitude, longitude]);
    }
  }, [latitude, longitude]);

  /* Reverse geocode + update */
  const updateLocation = async (lat: number, lng: number) => {
    setPosition([lat, lng]);

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
      );
      const data = await res.json();
      onChange(lat, lng, data?.display_name);
    } catch {
      onChange(lat, lng);
    }
  };

  if (!fixedCenterRef.current || !position) {
    return (
      <div
        className="rounded-[var(--r-card)] px-4 py-3 text-[12.5px] font-bold"
        style={{ background: "var(--clay-soft)", color: "var(--clay-ink)" }}
      >
        Waiting for your GPS fix — the map appears once the phone gets a location lock.
      </div>
    );
  }

  const center = fixedCenterRef.current;

  return (
    <div
      className="w-full h-[260px] overflow-hidden relative"
      style={{ borderRadius: "var(--r-card)", border: "1px solid var(--border)" }}
    >
      <MapContainer
        center={center}
        zoom={16}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <LocateMeButton onLocate={updateLocation} />

        {/* Allowed radius - mint, matching the rest of the system */}
        <Circle
          center={center}
          radius={radiusMeters}
          pathOptions={{
            color: "#0D9669",
            fillColor: "#0D9669",
            fillOpacity: 0.14,
          }}
        />

        {/* 🖱 Click restriction */}
        <ClickHandler
          center={center}
          radius={radiusMeters}
          onPick={updateLocation}
        />

        {/* 📌 Draggable marker */}
        <Marker
          position={position}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const marker = e.target as L.Marker;
              const p = marker.getLatLng();

              const d = distanceInMeters(
                center[0],
                center[1],
                p.lat,
                p.lng
              );

              if (d <= radiusMeters) {
                updateLocation(p.lat, p.lng);
              } else {
                marker.setLatLng(position);
                toast.error("Pin must stay inside the allowed radius.");
              }
            },
          }}
        />
      </MapContainer>

      <div
        className="text-[11px] font-bold px-3 py-2 border-t"
        style={{ background: "var(--bg)", color: "var(--text-muted)", borderColor: "var(--border)" }}
      >
        Drag the pin to fine-tune. You can only place it within {radiusMeters} m of your detected
        location.
      </div>
    </div>
  );
}
