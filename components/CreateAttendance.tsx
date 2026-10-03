"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Camera from "./camera";
import LocationVerify, { LocationVerifyHandle } from "./location-verify";
import { enqueuePendingLog } from "@/lib/offline-store";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { compressImage } from "@/lib/image-compress";
import { fetchGeofenceConfig, isWithinGeofence } from "@/lib/geofence";
import { CheckCircle2, LogIn, LogOut, FileText, AlertCircle } from "lucide-react";
import {
  MintButton,
  MintDialogHeader,
  MintDrawer,
  MintHint,
  MintInput,
  MintLabel,
  cx,
} from "@/components/mint";

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

export default function CreateAttendance({
  open,
  onOpenChangeAction,
  formData,
  onChangeAction,
  userDetails,
  fetchAccountAction,
  setFormAction,
}: CreateAttendanceProps) {
  /* The location card owns detection, the accuracy badge, the geofence verdict
     and the map. This sheet keeps only what it must display and what it must
     submit, reading the point through a ref at save time — so there is no
     window where React state and the submitted coordinate disagree.

     onLocationResolved is stable on purpose: LocationVerify re-runs detection
     whenever that callback identity changes, so an inline arrow here would
     re-detect on every render and never settle. */
  const locationRef = useRef<LocationVerifyHandle>(null);
  const [fixReady, setFixReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [faceData, setFaceData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [lastStatus, setLastStatus] = useState<"Login" | "Logout" | null>(null);
  const [lastTime, setLastTime] = useState<string | null>(null);

  const onLocationResolved = useCallback(() => setFixReady(true), []);

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    if (formData.Type !== "On Field") onChangeAction("Type", "On Field");
    setCapturedImage(null);
    setFixReady(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      credentials: "include", cache: "no-store"
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

    /* Read the point from the card, not from local state: this is the value
       that gets submitted, so the two cannot drift. */
    const fix = locationRef.current?.getFix() ?? null;
    if (!fix) return toast.error("Location not ready yet. Please wait.");

    const geo = locationRef.current?.getAudit() ?? {
      accuracyM: null,
      source: null,
      flag: null,
      distanceM: null,
      siteName: null,
    };

    // Save the new status to cache immediately
    const newStatus = formData.Status as "Login" | "Logout" | null;
    const newTime = new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    saveLastStatusToCache(newStatus, newTime);
    setLastStatus(newStatus);
    setLastTime(newTime);
    
    setLoading(true);

    // ── Office geofence check ─────────────────────────────────────────────
    // Still a hard block for a plain Clock In: this is the pre-existing rule
    // and it has always refused an off-site clock-in. A client visit is a
    // different case — it is warned and flagged, not refused, because an agent
    // legitimately standing near a client is not "away from the office".
    try {
      const geofence = await fetchGeofenceConfig();
      const within = isWithinGeofence(fix.lat, fix.lng, geofence);
      if (within === false) {
        toast.error("⚠️ You are outside the allowed area. Please move closer to the office to log attendance.", { duration: 6000 });
        setLoading(false);
        return;
      }
    } catch { /* non-critical — allow if geofence check fails */ }

    // ── Compress photo before storing/uploading ───────────────────────────
    let photo = capturedImage;
    try {
      photo = await compressImage(capturedImage);
    } catch { /* use original if compression fails */ }

    const basePayload = {
  ...formData,
  Location:  locationRef.current?.getAddress() || "",
  Latitude:  fix.lat,
  Longitude: fix.lng,
  FaceData:  faceData,
  manager:   userDetails.Manager,
  /* Sent so the server can record WHAT the fix was. GeoFlag is deliberately
     NOT sent — AddLog derives it from its own fence lookup, because a client
     that can name its own flag has no flag at all. */
  GeoAccuracyM: geo.accuracyM,
  GeoSource:    geo.source,
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
          credentials: "include", cache: "no-store",
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

  /* A poor fix does NOT disable submit — the spec wants the agent warned and
     allowed to proceed, with the record flagged. What blocks a save is only
     the absence of a fix, since there would be nothing to record. */
  const isSubmitDisabled =
    loading ||
    !formData.Status ||
    !capturedImage ||
    !fixReady;

  const online = typeof navigator !== "undefined" ? navigator.onLine : true;

  // Micro-copy so the agent always knows what happens next
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
              {/* Location first. The spec asks for it at the top, and it is the
                  right place on its own merits: an agent who is in the wrong
                  place should find out before they take a photo, not after. */}
              <LocationVerify
                ref={locationRef}
                open={open}
                onResolved={onLocationResolved}
              />

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


                  {/* Location moved to the top of the sheet - see LocationVerify above. */}
                  {/* Submit lives in the drawer footer so it's always reachable */}
                </>
              )}
      </div>
    </MintDrawer>
  );
}
