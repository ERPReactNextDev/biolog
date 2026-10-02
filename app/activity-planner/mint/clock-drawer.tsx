"use client";

/* ============================================================================
   CLOCK IN / CLOCK OUT — bottom drawer
   ----------------------------------------------------------------------------
   Deliberately standalone: this is NOT the components/CreateAttendance dialog.
   The field flow is only two things — a photo and a location — plus the
   Login/Logout value. Same route, same offline queue, same API payload.

   Reuses components/camera.tsx (face verification + countdown timer) and
   components/manual-location-picker.tsx, both of which are already Mint-styled.
   ========================================================================== */

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Check, LogIn, LogOut, MapPin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { MintButton, MintDrawer, MintLabel, MintPill } from "@/components/mint";
import Camera from "@/components/camera";
import { enqueuePendingLog } from "@/lib/offline-store";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { compressImage } from "@/lib/image-compress";
import { fetchGeofenceConfig, isWithinGeofence } from "@/lib/geofence";
import { computeLate, isShiftLog, nextClockAction, type ActivityLog, type UserDetails } from "./data";

// Leaflet reads `window` at module scope, so it must never be pulled into the
// server graph — same guard the CreateAttendance / CreateSalesAttendance
// dialogs use.
const ManualLocationPicker = dynamic(() => import("@/components/manual-location-picker"), {
  ssr: false,
});

type Status = "Login" | "Logout";

const LOCATION_PENDING = "Fetching location…";

function isLocationReady(addr: string): boolean {
  return (
    addr !== LOCATION_PENDING &&
    !addr.includes("permission denied") &&
    !addr.includes("unavailable") &&
    addr.length > 0
  );
}

export function ClockDrawer({
  open,
  onClose,
  userDetails,
  todayLogs,
  officeStart,
  gracePeriod,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  userDetails: UserDetails | null;
  todayLogs: ActivityLog[];
  officeStart: string;
  gracePeriod: number;
  onDone: () => void;
}) {
  // Pre-select the next SHIFT step. Site-visit Time In/Time Out rows are
  // ignored, so a visit never flips this to "Clock Out".
  const [status, setStatus] = useState<Status>(nextClockAction(todayLogs));

  const [photo, setPhoto] = useState<string | null>(null);
  const [faceData, setFaceData] = useState<any>(null);
  const [locationAddress, setLocationAddress] = useState(LOCATION_PENDING);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [manualLat, setManualLat] = useState<number | null>(null);
  const [manualLng, setManualLng] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  const late = computeLate(todayLogs, officeStart, gracePeriod);

  // A visit that has a Time In but no Time Out yet — the one real way the
  // Clock In → Time In → Time Out → Clock Out order can be broken.
  const openVisit = useMemo(() => {
    const visits = todayLogs.filter((l) => !isShiftLog(l));
    const timeIns = visits.filter((v) => v.Status === "Login").length;
    const timeOuts = visits.filter((v) => v.Status === "Logout").length;
    return Math.max(0, timeIns - timeOuts);
  }, [todayLogs]);

  useEffect(() => {
    if (!open) return;
    setStatus(nextClockAction(todayLogs));
    setPhoto(null);
    setFaceData(null);
    setLocationAddress(LOCATION_PENDING);
    setManualLat(null);
    setManualLng(null);
    setShowMap(false);
    getLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const getLocation = () => {
    setLocationAddress(LOCATION_PENDING);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationAddress("Location unavailable — check GPS settings.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setLatitude(lat);
        setLongitude(lng);
        const fallback = `Latitude: ${lat.toFixed(6)}, Longitude: ${lng.toFixed(6)}`;
        fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
        )
          .then((r) => r.json())
          .then((d) => setLocationAddress(d.display_name || fallback))
          .catch(() => setLocationAddress(fallback));
      },
      (err) => {
        setLocationAddress(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied."
            : "Location unavailable — set it on the map below."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const ready = Boolean(photo) && isLocationReady(locationAddress) && !saving;

  const submit = async () => {
    if (busyRef.current) return;
    if (!photo) {
      toast.error("Take a photo first — it's required for verification.");
      return;
    }
    if (!isLocationReady(locationAddress)) {
      toast.error("Location isn't ready. Wait a moment or set it on the map.");
      return;
    }
    busyRef.current = true;
    setSaving(true);

    const lat = manualLat ?? latitude;
    const lng = manualLng ?? longitude;

    // ── Geofence guard (non-blocking on failure) ──────────────────────────
    if (lat !== null && lng !== null) {
      try {
        const cfg = await fetchGeofenceConfig();
        if (isWithinGeofence(lat, lng, cfg) === false) {
          toast.error("You're outside the allowed area. Move closer to log attendance.", {
            duration: 6000,
          });
          return;
        }
      } catch {
        /* allow if the geofence check itself fails */
      }
    }

    let image = photo;
    try {
      image = await compressImage(photo);
    } catch {
      /* use the original if compression fails */
    }

    const payload = {
      ReferenceID: userDetails?.ReferenceID ?? "",
      Email: userDetails?.Email ?? "",
      TSM: userDetails?.TSM ?? "",
      manager: userDetails?.Manager,
      Type: "On Field",
      Status: status,
      Location: locationAddress,
      Latitude: lat,
      Longitude: lng,
      FaceData: faceData,
      // No remarks field on this flow — photo + location only
      Remarks: "",
      date_created: new Date().toISOString(),
    };

    try {
      // Offline first — never lose a field agent's log
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueuePendingLog({ ...payload, PhotoURL: image });
        window.dispatchEvent(new CustomEvent("acculog:sync"));
        toast.success("Saved offline — it will sync when you have signal.");
        onDone();
        onClose();
        return;
      }

      let photoURL: string;
      try {
        photoURL = await uploadToCloudinary(image);
      } catch {
        await enqueuePendingLog({ ...payload, PhotoURL: image });
        window.dispatchEvent(new CustomEvent("acculog:sync"));
        toast.success("Upload failed — saved offline and queued for retry.");
        onDone();
        onClose();
        return;
      }

      const res = await fetch("/api/ModuleSales/Activity/AddLog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", cache: "no-store",
        body: JSON.stringify({ ...payload, PhotoURL: photoURL }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || "Server error");
      }

      if ("vibrate" in navigator) navigator.vibrate([50, 30, 50]);
      toast.success(status === "Login" ? "Clocked in. Have a good shift." : "Clocked out. Nice work.");
      onDone();
      onClose();
    } catch (err: any) {
      // Last resort: queue it so the agent never has to redo the photo
      try {
        await enqueuePendingLog({ ...payload, PhotoURL: image });
        window.dispatchEvent(new CustomEvent("acculog:sync"));
        toast.success("Couldn't reach the server — saved offline instead.");
        onDone();
        onClose();
      } catch {
        toast.error(err?.message || "Couldn't save your log. Try again.");
      }
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  return (
    <MintDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      onClose={onClose}
      title={status === "Login" ? "Clock In" : "Clock Out"}
      description="Photo + location verification"
      tone={status === "Login" ? "mint" : "clay"}
      header={
        <div
          className="px-5 pb-5"
          style={{
            background:
              status === "Login"
                ? "linear-gradient(180deg, var(--mint-gradient) 0%, var(--card) 100%)"
                : "linear-gradient(180deg, var(--clay-soft) 0%, var(--card) 100%)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Attendance
              </p>
              <h2 className="text-[20px] font-black text-[var(--text)] leading-tight mt-0.5">
                {status === "Login" ? "Clock In" : "Clock Out"}
              </h2>
            </div>
            {late && status === "Login" && (
              <MintPill tone="clay" dot>
                Late arrival
              </MintPill>
            )}
          </div>

          {/* The value: Login or Logout */}
          <div className="grid grid-cols-2 gap-2.5 mt-4">
            {(
              [
                { v: "Login" as Status, label: "Clock In", Icon: LogIn },
                { v: "Logout" as Status, label: "Clock Out", Icon: LogOut },
              ]
            ).map(({ v, label, Icon }) => {
              const active = status === v;
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatus(v)}
                  className={
                    "mint-tap rounded-[var(--r-card)] border-2 p-3.5 flex flex-col items-center gap-1.5 " +
                    (active
                      ? v === "Login"
                        ? "border-[var(--mint)] bg-[var(--mint-soft)]"
                        : "border-[var(--clay)] bg-[var(--clay-soft)]"
                      : "border-[var(--border)] bg-[var(--card)]")
                  }
                >
                  <Icon
                    size={21}
                    style={{
                      color: active
                        ? v === "Login"
                          ? "var(--mint-strong)"
                          : "var(--clay-ink)"
                        : "var(--text-faint)",
                    }}
                  />
                  <span
                    className="text-[13px] font-extrabold"
                    style={{
                      color: active
                        ? v === "Login"
                          ? "var(--mint-strong)"
                          : "var(--clay-ink)"
                        : "var(--text-muted)",
                    }}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      }
      footer={
        <div
          className="px-5 pt-3.5 pb-4 shrink-0"
          style={{
            background: "var(--card)",
            borderTop: "1px solid var(--border)",
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <MintButton
            full
            size="lg"
            variant={status === "Login" ? "primary" : "clockout"}
            icon={status === "Login" ? <LogIn size={19} /> : <LogOut size={19} />}
            loading={saving}
            disabled={!ready}
            onClick={submit}
          >
            {status === "Login" ? "Confirm Clock In" : "Confirm Clock Out"}
          </MintButton>
          <p className="text-center text-[11px] font-semibold text-[var(--text-muted)] mt-2.5 leading-relaxed">
            {!photo
              ? "A photo is required before you can submit."
              : !isLocationReady(locationAddress)
                ? "Waiting on your location — you can also pin it on the map."
                : status === "Login"
                  ? "This starts your shift. Log every client visit before you clock out."
                  : "This ends your shift. Your supervisor sees the GPS pin, timestamp and photo."}
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-5 p-5" style={{ background: "var(--bg)" }}>
        {/* Photo / camera */}
        <div>
          <MintLabel>Photo Verification</MintLabel>
          {photo && (
            <div
              className="relative rounded-[var(--r-card-lg)] overflow-hidden mb-2.5"
              style={{ border: "1px solid var(--border)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="Verification" className="w-full h-40 object-cover" />
              <div
                className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center shadow-lg"
                style={{ background: "var(--mint-btn)" }}
              >
                <Check size={16} className="text-white" />
              </div>
            </div>
          )}
          <Camera
            registeredDescriptors={userDetails?.faceDescriptors}
            skipFaceVerification={userDetails?.faceVerificationEnabled === false}
            onCaptureAction={(img, face) => {
              setPhoto(img);
              setFaceData(face);
            }}
          />
        </div>

        {/* Location */}
        <div>
          <MintLabel>Location</MintLabel>
          <div
            className="rounded-[var(--r-card)] p-3.5 flex gap-3 items-start"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div
              className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
              style={{ background: "var(--mint-soft)" }}
            >
              <MapPin size={16} style={{ color: "var(--mint-strong)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-[10.5px] font-black uppercase tracking-wider"
                style={{ color: "var(--mint-strong)" }}
              >
                {locationAddress === LOCATION_PENDING ? "Detecting location…" : "Detected Location"}
              </p>
              <p className="text-[12.5px] font-semibold text-[var(--text)] mt-1 leading-relaxed">
                {locationAddress}
              </p>
              <div className="flex gap-2 mt-2.5 flex-wrap">
                <button
                  type="button"
                  onClick={getLocation}
                  className="min-h-[40px] px-3 rounded-full text-[11.5px] font-extrabold"
                  style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
                >
                  <RefreshCw size={12} className="inline mr-1" />
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!navigator.onLine) {
                      toast.error("The map isn't available offline.");
                      return;
                    }
                    setShowMap((v) => !v);
                  }}
                  className="min-h-[40px] px-3 rounded-full text-[11.5px] font-extrabold"
                  style={{ background: "var(--bg)", color: "var(--text-muted)" }}
                >
                  {showMap ? "Hide map" : "Set manually"}
                </button>
              </div>
            </div>
          </div>

          {/* Warn before breaking the Clock In → Time In → Time Out → Clock Out order */}
          {status === "Logout" && openVisit > 0 && (
            <div
              className="rounded-[var(--r-card)] p-3 flex items-start gap-2.5"
              style={{ background: "var(--hint-bg)", color: "var(--hint-text)" }}
            >
              <AlertTriangle size={15} className="shrink-0 mt-px" />
              <p className="text-[12px] font-bold leading-relaxed">
                {openVisit} site visit{openVisit !== 1 ? "s are" : " is"} still open — a Time In
                without a Time Out. Log the Time Out first, or your hours won't match your route.
              </p>
            </div>
          )}

          {showMap && (
            <div
              className="mt-2.5 rounded-[var(--r-card)] overflow-hidden"
              style={{ border: "1px solid var(--border)" }}
            >
              <ManualLocationPicker
                latitude={manualLat ?? latitude}
                longitude={manualLng ?? longitude}
                onChange={(lat, lng, address) => {
                  setManualLat(lat);
                  setManualLng(lng);
                  if (address) setLocationAddress(address);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </MintDrawer>
  );
}
