"use client";

/* ============================================================================
   components/location-verify.tsx
   ----------------------------------------------------------------------------
   The location block at the TOP of both attendance sheets.

   WHY IT IS A SHARED COMPONENT
   CreateAttendance and CreateSalesAttendance each had their own copy of this
   card, and they had already drifted — one hid the map behind a
   "location ready" condition and the other did not, one coloured the pin
   clay and the other mint, one retried with high accuracy and the other
   downgraded first. Two copies of the component that decides whether an agent
   can clock in is how an accuracy warning ends up on one screen and not the
   other.

   WHAT IT SHOWS, IN ORDER
     1. The detected address and an accuracy badge: Excellent / Good / Poor,
        with the metre figure.
     2. An amber banner ONLY when the fix is poor, carrying the copy from the
        spec: "Mababa ang accuracy — lumabas sa bukas na lugar o i-set
        manually." Never red. A warning an agent sees a dozen times a day must
        not read as an error, or they will stop reading it.
     3. A "Tama ba ito?" confirmation. A wrong-but-confident address in an
        attendance record is worse than no address.
     4. The geofence verdict when a client site is configured.
     5. Retry, Set manually, and the map.

   THE GEOFENCE VERDICT IS A HINT
   The authoritative check is in AddLog.ts, which recomputes the fence from its
   own lookup. Bypassing or tampering with this component cannot produce a
   clean record — it can only produce a record that gets flagged.
   ========================================================================== */

import dynamic from "next/dynamic";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, MapPin, RotateCcw, AlertTriangle, ShieldCheck, Info } from "lucide-react";
import { toast } from "sonner";
import {
  ACCEPT_M,
  FenceResult,
  GeoFix,
  POOR_ACCURACY_MESSAGE,
  captureBestPosition,
  coordsLabel,
  evaluateFence,
  geoAudit,
  gradeAccuracy,
  manualFix,
  reverseGeocode,
  saveLastKnown,
} from "@/lib/geo";
import { fetchSiteFence, SiteFence } from "@/lib/geofence";
import { Pill } from "@/app/activity-planner/mint/ui";

const ManualLocationPicker = dynamic(() => import("./manual-location-picker"), {
  ssr: false,
});

export interface LocationVerifyHandle {
  /** The point that will actually be submitted, or null if there is none yet. */
  getFix: () => GeoFix | null;
  /** The resolved address, falling back to raw coordinates. Never empty. */
  getAddress: () => string;
  /** The four geo columns, already reduced. Call at submit time. */
  getAudit: () => ReturnType<typeof geoAudit>;
}

interface LocationVerifyProps {
  open: boolean;
  /**
   * Which client site is being visited; drives the fence lookup. Null for a
   * plain Clock In — there is nothing to be outside of.
   */
  siteName?: string | null;
  /** Accent in the sheet's own colour. */
  accent?: "mint" | "clay";
  onResolved: (fix: GeoFix, address: string) => void;
}

type Phase = "locating" | "ready" | "manual";

const LocationVerify = forwardRef<LocationVerifyHandle, LocationVerifyProps>(
  function LocationVerify({ open, siteName = null, accent = "mint", onResolved }, ref) {
    const [phase, setPhase] = useState<Phase>("locating");
    const [address, setAddress] = useState("");
    const [fix, setFix] = useState<GeoFix | null>(null);
    const [note, setNote] = useState<string>("");
    const [siteFence, setSiteFence] = useState<SiteFence | null>(null);
    const [showMap, setShowMap] = useState(false);
    const [confirmed, setConfirmed] = useState(false);

    /* A ref, not state: the parent reads the final point at submit time, and
       lifting that through a callback would be the only alternative. */
    const fixRef = useRef<GeoFix | null>(null);
    const addressRef = useRef<string>("");

    const accentInk = accent === "clay" ? "var(--clay-ink)" : "var(--mint-strong)";
    const accentSoft = accent === "clay" ? "var(--clay-soft)" : "var(--mint-soft)";

    /* ── Detect ──────────────────────────────────────────────────────────
       Re-runs on open and when the target client changes, because the fence
       depends on the client. */
    const detect = useCallback(async () => {
      setPhase("locating");
      setConfirmed(false);
      setShowMap(false);
      setNote("");
      setFix(null);
      fixRef.current = null;
      setAddress("");

      const result = await captureBestPosition();

      if (!result.ok) {
        setPhase("manual");
        setNote(result.message);
        return;
      }

      const f = result.fix;
      fixRef.current = f;
      setFix(f);
      saveLastKnown(f);
      if (result.note) setNote(result.note);

      const geo = await reverseGeocode(f.lat, f.lng);
      const addr = geo.address ?? coordsLabel(f.lat, f.lng);
      addressRef.current = addr;
      setAddress(addr);
      setPhase("ready");
      onResolved(f, addr);
    }, [onResolved]);

    useEffect(() => {
      if (!open) return;
      detect();
    }, [open, siteName, detect]);

    /* ── Fence lookup ──────────────────────────────────────────────────── */
    useEffect(() => {
      let cancelled = false;
      if (!open || !siteName) {
        setSiteFence(null);
        return;
      }
      (async () => {
        const s = await fetchSiteFence(siteName);
        if (!cancelled) setSiteFence(s);
      })();
      return () => {
        cancelled = true;
      };
    }, [open, siteName]);

    /* Recomputed from the live fix, so a dragged pin re-verifies instantly. */
    const fenceResult: FenceResult | null = useMemo(() => {
      if (!siteFence || !fix) return null;
      return evaluateFence(fix.lat, fix.lng, {
        name: siteFence.siteName,
        latitude: siteFence.centerLat,
        longitude: siteFence.centerLng,
        radiusMeters: siteFence.radiusMeters,
      });
    }, [siteFence, fix]);

    useImperativeHandle(ref, () => ({
      getFix: () => fixRef.current,
      getAddress: () => {
        const f = fixRef.current;
        if (addressRef.current) return addressRef.current;
        return f ? coordsLabel(f.lat, f.lng) : "";
      },
      getAudit: () => geoAudit(fixRef.current, fenceResult),
    }));

    const grade = gradeAccuracy(fix?.accuracyM ?? null);
    const outside = fenceResult?.status === "outside";

    return (
      <div>
        <div
          className="rounded-[var(--r-card)] p-3.5 flex gap-3 items-start"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
            style={{ background: outside ? "var(--amber-soft)" : accentSoft }}
          >
            {phase === "locating" ? (
              <Loader2 size={16} className="animate-spin" style={{ color: accentInk }} />
            ) : outside ? (
              <AlertTriangle size={16} style={{ color: "var(--amber-ink)" }} />
            ) : (
              <MapPin size={16} style={{ color: accentInk }} />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Eyebrow + accuracy badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <p
                className="text-[10.5px] font-black uppercase tracking-wider"
                style={{ color: accentInk }}
              >
                {phase === "locating" ? "Detecting location…" : "Detected Location"}
              </p>
              {fix && fix.source === "manual" && (
                <Pill tone="neutral">Set manually</Pill>
              )}
              {fix && fix.source !== "manual" && grade.tier !== "unknown" && (
                <Pill tone={grade.tier === "poor" ? "amber" : "mint"}>
                  {grade.label} · {grade.detail}
                </Pill>
              )}
            </div>

            {/* Address */}
            <p className="text-[12.5px] font-semibold text-[var(--text)] mt-1 leading-relaxed">
              {phase === "locating"
                ? "Waiting for a GPS lock — step outside or away from thick walls for a better fix."
                : address || "No address yet."}
            </p>

            {/* "Tama ba ito?" — only once there is something to confirm */}
            {phase === "ready" && address && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span
                  className="text-[11px] font-extrabold"
                  style={{ color: "var(--text-muted)" }}
                >
                  Tama ba ito?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmed(true)}
                  aria-pressed={confirmed}
                  className="min-h-[32px] px-2.5 rounded-full text-[11px] font-extrabold transition-all active:scale-95"
                  style={{
                    background: confirmed ? "var(--mint-btn)" : "var(--mint-soft)",
                    color: confirmed ? "#fff" : "var(--mint-strong)",
                  }}
                >
                  {confirmed ? "Confirmed" : "Yes, correct"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowMap(true)}
                  className="min-h-[32px] px-2.5 rounded-full text-[11px] font-extrabold"
                  style={{ background: "var(--bg)", color: "var(--text-muted)" }}
                >
                  No, let me fix it
                </button>
              </div>
            )}

            {/* Amber — poor accuracy only. Never red. */}
            {grade.warn && (
              <p
                className="text-[11.5px] font-bold mt-2 leading-relaxed"
                style={{ color: "var(--amber-ink)" }}
              >
                {POOR_ACCURACY_MESSAGE}
              </p>
            )}

            {/* Provenance: stale cache, network fallback, denial */}
            {note && (
              <p
                className="text-[11px] font-semibold text-[var(--text-muted)] mt-1.5 leading-relaxed"
              >
                {note}
              </p>
            )}

            {/* Geofence verdict */}
            {fenceResult?.status === "inside" && (
              <p
                className="text-[11px] font-bold mt-2 flex items-center gap-1.5"
                style={{ color: "var(--mint-strong)" }}
              >
                <ShieldCheck size={13} />
                Inside {siteFence?.siteName} · {fenceResult.distanceM} m of{" "}
                {fenceResult.radiusM} m
              </p>
            )}

            {fenceResult?.status === "outside" && (
              <div className="rounded-[12px] px-3 py-2.5 mt-2" style={{ background: "var(--amber-soft)" }}>
                <p
                  className="text-[11.5px] font-extrabold flex items-center gap-1.5"
                  style={{ color: "var(--amber-ink)" }}
                >
                  <AlertTriangle size={13} />
                  {fenceResult.overshootM} m outside {fenceResult.siteName}
                </p>
                <p
                  className="text-[11px] font-semibold mt-1 leading-relaxed"
                  style={{ color: "var(--amber-ink)" }}
                >
                  A photo and a short note about why are required. Your manager will see this on the
                  review list.
                </p>
              </div>
            )}

            {phase === "manual" && (
              <p
                className="text-[11px] font-semibold mt-2 flex items-start gap-1.5"
                style={{ color: "var(--text-muted)" }}
              >
                <Info size={13} className="mt-0.5 shrink-0" />
                GPS is unavailable. Use &ldquo;Set manually&rdquo; below so your record is not blank.
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-2.5 flex-wrap">
              <button
                type="button"
                onClick={detect}
                disabled={phase === "locating"}
                className="min-h-[40px] px-3 rounded-full text-[11.5px] font-extrabold inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{ background: accentSoft, color: accentInk }}
              >
                {phase === "locating" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RotateCcw size={13} />
                )}
                Retry location
              </button>
              <button
                type="button"
                onClick={() => setShowMap(!showMap)}
                disabled={!fix}
                className="min-h-[40px] px-3 rounded-full text-[11.5px] font-extrabold inline-flex items-center gap-1.5 disabled:opacity-40"
                style={{ background: "var(--bg)", color: "var(--text-muted)" }}
              >
                <MapPin size={13} />
                {showMap ? "Hide map" : "Set manually"}
              </button>
            </div>
          </div>
        </div>

        {/* The map */}
        {showMap && fix && (
          <div
            className="mt-2.5 rounded-[var(--r-card)] overflow-hidden"
            style={{ border: "1px solid var(--border)" }}
          >
            <ManualLocationPicker
              latitude={fix.lat}
              longitude={fix.lng}
              accuracyMeters={fix.accuracyM}
              clampRadiusMeters={siteFence ? siteFence.radiusMeters : null}
              fence={
                siteFence
                  ? {
                      centerLat: siteFence.centerLat,
                      centerLng: siteFence.centerLng,
                      radiusMeters: siteFence.radiusMeters,
                      label: siteFence.siteName,
                    }
                  : null
              }
              onChange={(lat, lng, addr) => {
                const f = manualFix(lat, lng, fix.accuracyM);
                fixRef.current = f;
                setFix(f);
                const label = addr ?? coordsLabel(lat, lng);
                addressRef.current = label;
                if (addr) setAddress(addr);
                setConfirmed(true);
                onResolved(f, label);
                toast.success("Location updated.");
              }}
            />
          </div>
        )}

        {/* A submitted point the agent never confirmed is worth saying out
            loud — it is the one case where the record and the agent's
            understanding can diverge. */}
        {!confirmed && phase === "ready" && fix?.source !== "manual" && grade.tier !== "poor" && (
          <p className="text-[10.5px] font-semibold text-[var(--text-faint)] mt-1.5">
            Unconfirmed addresses are still recorded with the accuracy above.
          </p>
        )}
      </div>
    );
  }
);

export default LocationVerify;

/** Re-exported so the sheets can build the same Poor warning without a copy. */
export const POOR_FIX_WARNING = POOR_ACCURACY_MESSAGE;

/** True when this fix should stop a submit until the agent acknowledges it. */
export function isPoorFix(fix: GeoFix | null): boolean {
  return fix != null && fix.accuracyM != null && fix.accuracyM > ACCEPT_M;
}