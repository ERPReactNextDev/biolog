"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import Camera from "./camera";
import { enqueuePendingLog } from "@/lib/offline-store";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { compressImage } from "@/lib/image-compress";
import { fetchGeofenceConfig, isWithinGeofence } from "@/lib/geofence";
import { MapPin, CheckCircle2, LogIn, LogOut, FileText, AlertCircle } from "lucide-react";
import {
  MintButton,
  MintDialogHeader,
  MintDrawer,
  MintHint,
  MintInput,
  MintLabel,
  cx,
} from "@/components/mint";

const ManualLocationPicker = dynamic(() => import("./manual-location-picker"), { ssr: false });

interface FormData {
  ReferenceID: string;
  Email: string;
  Type: string;
  Status: string;
  PhotoURL: string;
  Remarks: string;
  TSM: string;
  manager?: string;
  _id?: string;
}

interface UserDetails {
  ReferenceID: string;
  Email: string;
  TSM: string;
  Manager?: string;
  faceDescriptors?: number[][];
  faceVerificationEnabled?: boolean;
}
interface CreateAttendanceProps {
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  formData: FormData;
  onChangeAction: (field: Exclude<keyof FormData, "_id">, value: any) => void;
  userDetails: UserDetails;
  fetchAccountAction: () => void;
  setFormAction: React.Dispatch<React.SetStateAction<FormData>>;
}

const LOCATION_PENDING = "Fetching location...";

function isLocationReady(addr: string): boolean {
  return (
    addr !== LOCATION_PENDING &&
    !addr.includes("permission denied") &&
    addr.length > 0
  );
}

export default function CreateAttendance({
  open,
  onOpenChangeAction,
  formData,
  onChangeAction,
  userDetails,
  fetchAccountAction,
  setFormAction,
}: CreateAttendanceProps) {
  const [locationAddress, setLocationAddress] = useState(LOCATION_PENDING);
  const [manualLat, setManualLat] = useState<number | null>(null);
  const [manualLng, setManualLng] = useState<number | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [faceData, setFaceData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [lastStatus, setLastStatus] = useState<"Login" | "Logout" | null>(null);
  const [lastTime, setLastTime] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    if (formData.Type !== "On Field") onChangeAction("Type", "On Field");
    setCapturedImage(null);
    setLocationAddress(LOCATION_PENDING);
    setManualLat(null);
    setManualLng(null);
    setShowMap(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Geolocation function
  const getLocation = () => {
    setLocationAddress(LOCATION_PENDING);
    const options: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

    const onSuccess = (pos: GeolocationPosition) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      setLatitude(lat);
      setLongitude(lng);

      const latLngFallback = `Latitude: ${lat.toFixed(6)}, Longitude: ${lng.toFixed(6)}`;
      
      // Reverse geocode — if offline this will fail, fall back to coords string
      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
        .then((r) => r.json())
        .then((d) => setLocationAddress(d.display_name || latLngFallback))
        .catch(() => setLocationAddress(latLngFallback));
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE) {
        // Retry with lower accuracy
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          () => setLocationAddress("Location unavailable — check GPS settings."),
          { ...options, enableHighAccuracy: false, timeout: 10000 }
        );
      } else {
        setLocationAddress("Location permission denied.");
      }
    };

    if (!navigator.geolocation) {
      setLocationAddress("Geolocation not supported.");
      return;
    }

    navigator.geolocation.getCurrentPosition(onSuccess, onError, options);
  };

  // Geolocation
  useEffect(() => {
    if (!open) return;
    getLocation();
  }, [open]);

  /* ── Helper functions for last status cache ── */
  const getLastStatusCacheKey = () => {
    const today = new Date().toISOString().split('T')[0];
    return `create-attendance-last-status-${userDetails.ReferenceID}-${today}`;
  };

  const saveLastStatusToCache = (status: "Login" | "Logout" | null, time: string | null) => {
    try {
      const cacheData = {
        status,
        time,
        timestamp: Date.now()
      };
      localStorage.setItem(getLastStatusCacheKey(), JSON.stringify(cacheData));
    } catch (e) {
      console.error("Failed to save last status to cache", e);
    }
  };

  const loadLastStatusFromCache = () => {
    try {
      const cached = localStorage.getItem(getLastStatusCacheKey());
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.error("Failed to load last status from cache", e);
    }
    return null;
  };

  const clearOldLastStatusCaches = () => {
    try {
      const prefix = `create-attendance-last-status-${userDetails.ReferenceID}-`;
      
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix) && key !== getLastStatusCacheKey()) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.error("Failed to clear old last status caches", e);
    }
  };

  // Clear old caches when dialog opens
  useEffect(() => {
    if (open && userDetails.ReferenceID) {
      clearOldLastStatusCaches();
    }
  }, [open, userDetails.ReferenceID]);

  // Fetch last status
  useEffect(() => {
    if (!open) return;
    
    // First try to load from cache
    const cachedStatus = loadLastStatusFromCache();
    if (cachedStatus) {
      setLastStatus(cachedStatus.status);
      setLastTime(cachedStatus.time);
    }
    
    fetch(`/api/ModuleSales/Activity/LastStatus?referenceId=${userDetails.ReferenceID}&type=On Field`, {
      credentials: "include"
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.lastStatus) {
          const time = data.lastTime ? new Date(data.lastTime).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) : null;
          setLastStatus(data.lastStatus);
          setLastTime(time);
          saveLastStatusToCache(data.lastStatus, time);
        } else {
          setLastStatus(null);
          setLastTime(null);
          saveLastStatusToCache(null, null);
        }
      })
      .catch(() => { /* silent — offline, use cached status if available */ });
  }, [open, userDetails.ReferenceID]);

  const resetForm = () => {
    setFormAction({ ReferenceID: userDetails.ReferenceID, Email: userDetails.Email, Type: "On Field", Status: "", PhotoURL: "", Remarks: "", TSM: userDetails.TSM });
    setCapturedImage(null);
  };

  const handleCreate = async () => {
    if (!capturedImage) return toast.error("Please capture a photo first.");
    if (!formData.Status) return toast.error("Please select Login or Logout.");
    if (!isLocationReady(locationAddress)) return toast.error("Location not ready yet. Please wait.");

    // Save the new status to cache immediately
    const newStatus = formData.Status as "Login" | "Logout" | null;
    const newTime = new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    saveLastStatusToCache(newStatus, newTime);
    setLastStatus(newStatus);
    setLastTime(newTime);
    
    setLoading(true);

    // ── Geofence check ────────────────────────────────────────────────────
    if (latitude !== null && longitude !== null) {
      try {
        const geofence = await fetchGeofenceConfig();
        const within = isWithinGeofence(latitude, longitude, geofence);
        if (within === false) {
          toast.error("⚠️ You are outside the allowed area. Please move closer to the office to log attendance.", { duration: 6000 });
          setLoading(false);
          return;
        }
      } catch { /* non-critical — allow if geofence check fails */ }
    }

    // ── Compress photo before storing/uploading ───────────────────────────
    let photo = capturedImage;
    try {
      photo = await compressImage(capturedImage);
    } catch { /* use original if compression fails */ }

const basePayload = {
  ...formData,
  Location:  locationAddress,
  Latitude:  manualLat ?? latitude,
  Longitude: manualLng ?? longitude,
  FaceData:  faceData,
  manager:   userDetails.Manager,
};

    try {
      if (!navigator.onLine) {
        await enqueuePendingLog({ ...basePayload, PhotoURL: photo });
        toast.success("Saved offline — will sync when you're back online.", {
          duration: 4000,
        });
        // Dispatch custom event to trigger pending count refresh
        window.dispatchEvent(new CustomEvent("acculog:sync"));
        onOpenChangeAction(false);
        resetForm();
        return;
      }

      let photoURL: string;
      try {
        photoURL = await uploadToCloudinary(photo);
      } catch {
        await enqueuePendingLog({ ...basePayload, PhotoURL: photo });
        toast.success("Photo upload failed — saved offline. Will sync when connection improves.");
        onOpenChangeAction(false);
        resetForm();
        return;
      }

      try {
        const res = await fetch("/api/ModuleSales/Activity/AddLog", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body:    JSON.stringify({ ...basePayload, PhotoURL: photoURL }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Server error");
        toast.success("Attendance recorded successfully!");
        if ("vibrate" in navigator) navigator.vibrate([50, 30, 50]);
        fetchAccountAction();
        onOpenChangeAction(false);
        resetForm();
      } catch {
        await enqueuePendingLog({ ...basePayload, PhotoURL: photoURL });
        toast.success("Saved offline — will sync when connection returns.");
        onOpenChangeAction(false);
        resetForm();
      }
    } catch (err: any) {
      toast.error(err?.message || "Error saving attendance.");
    } finally {
      setLoading(false);
    }
  };

  const isSubmitDisabled =
    loading ||
    !formData.Status ||
    !capturedImage ||
    !isLocationReady(locationAddress);

  const online = typeof navigator !== "undefined" ? navigator.onLine : true;

  // Micro-copy so the agent always knows what happens next
  const nextAction = lastStatus === "Login" ? "Logout" : "Login";
  const footerHint = !online
    ? "Saved to this phone — it uploads automatically once you have signal."
    : formData.Status === "Logout"
      ? "This ends your shift for today. Your supervisor sees the GPS and timestamp."
      : "This starts your shift. You'll be able to log site visits after clocking in.";

  return (
    <MintDrawer
      open={open}
      onOpenChange={onOpenChangeAction}
      onClose={() => onOpenChangeAction(false)}
      title="Create Attendance"
      description="Field log entry"
      header={
        <MintDialogHeader
          title="Create Attendance"
          subtitle="Field log entry"
          onClose={() => onOpenChangeAction(false)}
          right={
            <div className="text-right shrink-0">
              <p className="text-[11px] font-bold text-[var(--text-muted)]">
                {new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
              </p>
              <p className="mint-num text-[13px] font-black text-[var(--text)]">
                {new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          }
        />
      }
      footer={
        capturedImage && formData.Status ? (
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
              variant={formData.Status === "Logout" ? "clockout" : "primary"}
              icon={<CheckCircle2 size={19} />}
              loading={loading}
              disabled={isSubmitDisabled}
              onClick={handleCreate}
            >
              {online
                ? formData.Status === "Logout"
                  ? "Submit Clock Out"
                  : "Submit Clock In"
                : "Save Offline"}
            </MintButton>
            <p className="text-center text-[11px] font-semibold text-[var(--text-muted)] mt-2.5 leading-relaxed">
              {footerHint}
            </p>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 p-5" style={{ background: "var(--bg)" }}>
              {/* Current status — always tells you the next action */}
              {lastStatus ? (
                <div
                  className="rounded-[var(--r-card)] p-3.5 flex items-start gap-3"
                  style={{
                    background: lastStatus === "Login" ? "var(--mint-soft)" : "var(--alert-soft)",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
                    style={{ background: "var(--card)" }}
                  >
                    {lastStatus === "Login" ? (
                      <CheckCircle2 size={17} style={{ color: "var(--mint-strong)" }} />
                    ) : (
                      <AlertCircle size={17} style={{ color: "var(--alert-ink)" }} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[13px] font-extrabold"
                      style={{
                        color: lastStatus === "Login" ? "var(--mint-strong)" : "var(--alert-ink)",
                      }}
                    >
                      Currently {lastStatus === "Login" ? "Clocked In" : "Clocked Out"}
                    </p>
                    {lastTime && (
                      <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                        Last action at {lastTime}
                      </p>
                    )}
                    <p className="text-[11.5px] font-bold text-[var(--text-muted)] mt-1.5 leading-relaxed">
                      {lastStatus === "Login"
                        ? "You can log client visits now. Use Clock Out when you head home."
                        : "You're off duty. Clock In to start your shift and record site visits."}
                    </p>
                  </div>
                </div>
              ) : (
                <MintHint icon={<AlertCircle size={14} />}>
                  We couldn&apos;t read your last clock action. Pick one below and it will be
                  recorded either way.
                </MintHint>
              )}

              {/* Camera */}
              <div>
                <MintLabel>Photo Verification</MintLabel>
                <Camera
                  registeredDescriptors={userDetails.faceDescriptors}
                  skipFaceVerification={userDetails.faceVerificationEnabled === false}
                  onCaptureAction={(img, face) => {
                    setCapturedImage(img);
                    setFaceData(face);
                  }}
                />
              </div>

              {capturedImage && (
                <>
                  {/* Attendance status */}
                  <div>
                    <MintLabel>Attendance Status</MintLabel>
                    <div className="grid grid-cols-2 gap-2.5">
                      {(
                        [
                          { v: "Login", label: "Clock In", sub: "Start of shift", Icon: LogIn },
                          { v: "Logout", label: "Clock Out", sub: "End of shift", Icon: LogOut },
                        ] as const
                      ).map(({ v, label, sub, Icon }) => {
                        const selected = formData.Status === v;
                        const blocked = lastStatus === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() => onChangeAction("Status", v)}
                            disabled={blocked}
                            aria-pressed={selected}
                            className={cx(
                              "mint-tap rounded-[var(--r-card)] border-2 p-3.5 flex flex-col items-center gap-1.5 text-left",
                              selected
                                ? "border-[var(--mint)] bg-[var(--mint-soft)]"
                                : "border-[var(--border)] bg-[var(--card)]",
                              blocked && "opacity-40 cursor-not-allowed"
                            )}
                          >
                            <Icon
                              size={20}
                              style={{
                                color: selected ? "var(--mint-strong)" : "var(--text-faint)",
                              }}
                            />
                            <span
                              className="text-[13px] font-extrabold"
                              style={{
                                color: selected ? "var(--mint-strong)" : "var(--text)",
                              }}
                            >
                              {label}
                            </span>
                            <span className="text-[10px] font-semibold text-[var(--text-muted)]">
                              {blocked ? "Already done" : sub}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Remarks */}
                  <div>
                    <MintLabel>
                      <span className="inline-flex items-center gap-1.5">
                        <FileText size={12} /> Remarks
                      </span>
                    </MintLabel>
                    <MintInput
                      textarea
                      value={formData.Remarks}
                      onChange={(e) => onChangeAction("Remarks", e.target.value)}
                      placeholder="Add notes or remarks (optional)…"
                    />
                  </div>

                  {/* Location */}
                  <div>
                    <MintLabel>Location</MintLabel>
                    <div
                      className="rounded-[var(--r-card)] p-3.5 flex gap-3 items-start"
                      style={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                      }}
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
                          {locationAddress === LOCATION_PENDING
                            ? "Detecting location…"
                            : "Detected Location"}
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
                            Retry location
                          </button>
                          {isLocationReady(locationAddress) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!navigator.onLine) {
                                  toast.error("Manual map is not available offline.");
                                  return;
                                }
                                setShowMap(!showMap);
                              }}
                              className="min-h-[40px] px-3 rounded-full text-[11.5px] font-extrabold"
                              style={{ background: "var(--bg)", color: "var(--text-muted)" }}
                            >
                              {showMap ? "Hide map" : "Set manually →"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
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

                  {/* Submit lives in the drawer footer so it's always reachable */}
                </>
              )}
      </div>
    </MintDrawer>
  );
}
