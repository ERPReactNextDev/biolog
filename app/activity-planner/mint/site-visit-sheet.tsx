"use client";

/* ============================================================================
   SITE VISIT LOG — bottom drawer
   ----------------------------------------------------------------------------
   Bottom sheet per the brief: drag handle, slide-up animation, 26px top radius.
   Built on MintDrawer (Radix Sheet) so we get focus trapping, Escape-to-close
   and scroll lock rather than a hand-rolled animated overlay.
   ========================================================================== */

import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  MapPin,
  RefreshCw,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { MintButton, MintDrawer, MintInput, MintLabel, MintPill } from "@/components/mint";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { compressImage } from "@/lib/image-compress";

type ClientType = "new" | "existing";
type NextAction = "Login" | "Logout";

export interface SiteVisitPayload {
  photoUrl: string;
  nextAction: NextAction;
  clientType: ClientType;
  remarks: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
}

/** FileReader → base64 data URL (what uploadToCloudinary expects). */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function SiteVisitSheet({
  open,
  onClose,
  onSubmit,
  visitCountToday,
  suggestedAction = "Login",
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (p: SiteVisitPayload) => Promise<void> | void;
  visitCountToday: number;
  /**
   * Time In / Time Out derived from client-visit rows ONLY. Defaults to
   * "Logout" when the agent already has an unclosed visit, so the drawer
   * offers Time Out instead of always opening on Time In.
   */
  suggestedAction?: NextAction;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [nextAction, setNextAction] = useState<NextAction>(suggestedAction);
  const [clientType, setClientType] = useState<ClientType>("new");
  const [remarks, setRemarks] = useState("");
  const [location, setLocation] = useState<string>("Detecting your location…");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locLoading, setLocLoading] = useState(true);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualText, setManualText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset each time the drawer opens
  useEffect(() => {
    if (!open) return;
    setPhoto(null);
    setNextAction(suggestedAction);
    setClientType("new");
    setRemarks("");
    setManualEntry(false);
    setManualText("");
    setSubmitting(false);
    detectLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, suggestedAction]);

  const detectLocation = () => {
    setLocLoading(true);
    setManualEntry(false);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocation("Location unavailable — set it manually");
      setLocLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords({ lat: latitude, lng: longitude });
        setLocation(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
            { headers: { "Accept-Language": "en" } }
          );
          if (res.ok) {
            const d = await res.json();
            if (d?.display_name) setLocation(d.display_name);
          }
        } catch {
          /* keep coordinates — good enough for a field log */
        }
        setLocLoading(false);
      },
      () => {
        setLocation("Couldn't get GPS — set it manually");
        setLocLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  const pickPhoto = () => {
    fileRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto("pending");
    try {
      // Compress before upload — field devices on mobile data
      const raw = await readAsBase64(file);
      let data = raw;
      try {
        data = await compressImage(raw);
      } catch {
        /* fall back to the original if compression fails */
      }
      const url = await uploadToCloudinary(data);
      setPhoto(url);
      toast.success("Photo captured successfully.");
    } catch {
      setPhoto(null);
      toast.error("Couldn't process the photo. Try retaking it.");
    }
    e.target.value = "";
  };

  const submit = async () => {
    if (!photo || photo === "pending") {
      toast.error("Take a photo first — it's required for client verification.");
      return;
    }
    if (locLoading) {
      toast.error("Still getting your location. Wait a moment or set it manually.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        photoUrl: photo,
        nextAction,
        clientType,
        remarks: remarks.trim(),
        location,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MintDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      onClose={onClose}
      title="Site Visit Log"
      description="Client attendance entry"
      tone="clay"
      header={
        <div
          className="px-5 pt-2 pb-5 flex-shrink-0"
          style={{
            background:
              "linear-gradient(180deg, var(--clay-soft) 0%, var(--card) 100%)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[19px] font-black text-[var(--text)] leading-tight">
                Site Visit Log
              </h2>
              <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                Client attendance entry
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <MintPill tone="neutral">Today {visitCountToday}</MintPill>
            </div>
          </div>

          {/* Next action */}
          <div className="flex items-center gap-2.5 mt-4 flex-wrap">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
              Next action
            </span>
            <div className="flex gap-1.5">
              {(["Login", "Logout"] as NextAction[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={nextAction === a}
                  onClick={() => setNextAction(a)}
                  className={
                    "min-h-[40px] px-4 rounded-full text-[12.5px] font-extrabold border transition-all active:scale-95 " +
                    (nextAction === a
                      ? "bg-[var(--mint-btn)] text-white border-transparent shadow-[0_4px_12px_rgba(13,150,105,.25)]"
                      : "bg-[var(--card)] text-[var(--text-muted)] border-[var(--border)]")
                  }
                >
                  {/* Client-visit rows are Time In / Time Out. Calling them
                      "Clock In/Out" is what made this read as the shift clock. */}
                  {a === "Login" ? "Time In" : "Time Out"}
                </button>
              ))}
            </div>
            <p className="text-[11px] font-semibold text-[var(--text-muted)] w-full -mt-1">
              {nextAction === "Logout"
                ? "You have an open site visit — log the Time Out when you leave the client."
                : "Starting a site visit. Log the Time Out when you leave the client."}
            </p>
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
            variant={nextAction === "Logout" ? "clockout" : "primary"}
            icon={<Send size={19} />}
            loading={submitting}
            onClick={submit}
          >
            Submit Log
          </MintButton>
        </div>
      }
    >
      <div className="flex flex-col gap-5 p-5" style={{ background: "var(--bg)" }}>
        {/* Photo verification */}
        <div>
          <MintLabel>Photo Verification</MintLabel>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            className="hidden"
            aria-label="Take client photo"
          />

          {photo && photo !== "pending" ? (
            <>
              <div
                className="relative rounded-[var(--r-card-lg)] overflow-hidden border border-[var(--border)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo}
                  alt="Client verification"
                  className="w-full h-44 object-cover"
                />
                <div
                  className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center shadow-lg"
                  style={{ background: "var(--mint-btn)" }}
                >
                  <Check size={16} className="text-white" />
                </div>
              </div>
              <div
                className="flex items-center gap-2 rounded-[14px] px-3.5 py-2.5 mt-2.5"
                style={{ background: "var(--mint-soft)" }}
              >
                <Check size={14} style={{ color: "var(--mint-strong)" }} className="shrink-0" />
                <p className="text-[12px] font-bold text-[var(--mint-strong)]">
                  Photo captured successfully
                </p>
              </div>
              <MintButton
                variant="secondary"
                size="md"
                full
                className="mt-2.5"
                icon={<RefreshCw size={17} />}
                onClick={pickPhoto}
              >
                Retake Photo
              </MintButton>
            </>
          ) : (
            <button
              type="button"
              onClick={pickPhoto}
              className="mint-tap w-full rounded-[var(--r-card-lg)] border-2 border-dashed h-44 flex flex-col items-center justify-center"
              style={{
                borderColor: "var(--border-strong)",
                background: "var(--card-alt)",
              }}
            >
              {photo === "pending" ? (
                <>
                  <RefreshCw size={26} className="animate-spin" style={{ color: "var(--mint)" }} />
                  <p className="text-[12.5px] font-bold text-[var(--text-muted)] mt-2.5">
                    Processing photo…
                  </p>
                </>
              ) : (
                <>
                  <div
                    className="w-14 h-14 rounded-[18px] flex items-center justify-center"
                    style={{ background: "var(--mint-soft)" }}
                  >
                    <Camera size={24} style={{ color: "var(--mint)" }} />
                  </div>
                  <p className="text-[13.5px] font-extrabold text-[var(--text)] mt-3">
                    Take Client Photo
                  </p>
                  <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-1 text-center px-6">
                    Required for verification — include the client and their store sign
                  </p>
                </>
              )}
            </button>
          )}
        </div>

        {/* Client type */}
        <div>
          <MintLabel>Client Type</MintLabel>
          <div className="grid grid-cols-2 gap-2.5">
            {(
              [
                { v: "new" as ClientType, label: "New Client", Icon: UserPlus },
                { v: "existing" as ClientType, label: "Existing Client", Icon: Users },
              ]
            ).map(({ v, label, Icon }) => {
              const active = clientType === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setClientType(v)}
                  aria-pressed={active}
                  className={
                    "mint-tap rounded-[var(--r-card)] border-2 p-3.5 flex flex-col items-center gap-2 " +
                    (active ? "border-[var(--mint)] bg-[var(--mint-soft)]" : "border-[var(--border)] bg-[var(--card)]")
                  }
                >
                  <Icon
                    size={21}
                    style={{ color: active ? "var(--mint-strong)" : "var(--text-faint)" }}
                  />
                  <span
                    className="text-[12.5px] font-extrabold"
                    style={{ color: active ? "var(--mint-strong)" : "var(--text-muted)" }}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Remarks */}
        <div>
          <MintLabel>
            Remarks{" "}
            <span className="normal-case font-semibold text-[var(--text-faint)]">
              (optional)
            </span>
          </MintLabel>
          <MintInput
            textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Add notes or feedback…"
            aria-label="Remarks"
          />
        </div>

        {/* Location */}
        <div>
          <MintLabel>Location</MintLabel>
          {manualEntry ? (
            <div>
              <MintInput
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="e.g. People Power Monument, Quezon City"
                aria-label="Manual location"
                autoFocus
              />
              <div className="flex gap-2 mt-2">
                <MintButton
                  size="sm"
                  full
                  onClick={() => {
                    const t = manualText.trim();
                    if (!t) return;
                    setLocation(t);
                    setManualEntry(false);
                  }}
                >
                  Use this location
                </MintButton>
                <MintButton size="sm" variant="secondary" onClick={detectLocation}>
                  Use GPS
                </MintButton>
              </div>
            </div>
          ) : (
            <>
              <div
                className="rounded-[var(--r-card)] p-3.5"
                style={{ background: "var(--alert-soft)" }}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className="w-8 h-8 rounded-[11px] flex items-center justify-center shrink-0"
                    style={{ background: "var(--card)" }}
                  >
                    <MapPin size={15} style={{ color: "var(--alert)" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[10.5px] font-black uppercase tracking-wider flex items-center gap-1.5"
                      style={{ color: "var(--alert-ink)" }}
                    >
                      Detected Location
                      {locLoading && (
                        <RefreshCw size={10} className="animate-spin" aria-hidden />
                      )}
                    </p>
                    <p className="text-[12.5px] font-bold text-[var(--text)] mt-1 leading-relaxed">
                      {location}
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setManualEntry(true)}
                className="w-full min-h-[44px] text-[12.5px] font-extrabold text-[var(--mint-strong)] mt-1"
              >
                Set manually →
              </button>
            </>
          )}
        </div>
      </div>
    </MintDrawer>
  );
}
