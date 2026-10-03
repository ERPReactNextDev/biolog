"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Camera from "./camera";
import LocationVerify, { LocationVerifyHandle } from "./location-verify";
import Select from "react-select";
import { ArrowLeft, LogIn, LogOut, FileText, UserPlus, Users, AlertCircle, Loader2 } from "lucide-react";
import { MintButton, MintDrawer, MintInput, MintLabel, MintPill } from "@/components/mint";
import { enqueuePendingLog } from "@/lib/offline-store";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { compressImage } from "@/lib/image-compress";
import { fetchGeofenceConfig, isWithinGeofence } from "@/lib/geofence";
import type { GeoFix } from "@/lib/geo";

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface FormData {
  ReferenceID: string;
  TSM: string;
  Email: string;
  Type: string;
  Status: string;
  PhotoURL: string;
  Remarks: string;
  SiteVisitAccount?: string;
  manager?: string; // Add manager field
  // New Client Fields
  company_name?: string;
  contact_person?: string;
  contact_number?: string;
  email_address?: string;
  address?: string;
}

interface UserDetails {
  ReferenceID: string;
  TSM: string;
  Manager?: string; // Add Manager to UserDetails
  Email: string;
  Role: string;
  faceDescriptors?: number[][];
  faceVerificationEnabled?: boolean;
}

interface CreateAttendanceProps {
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  formData: FormData;
  onChangeAction: (field: keyof FormData, value: any) => void;
  userDetails: UserDetails;
  fetchAccountAction: () => void;
  setFormAction: React.Dispatch<React.SetStateAction<FormData>>;
  /**
   * Whether this agent may pick/search a client at all. Set per-user in
   * Admin -> Users (can_lookup_clients) and delivered by
   * GET /api/attendance/drawer.
   *
   * Defaults to true so the drawer is unchanged until an admin opts somebody
   * out. When false the New/Existing client picker, the client-name fields and
   * the account search are all hidden, and the Logout validation stops
   * demanding a client — otherwise the agent would be permanently unable to
   * clock out.
   */
  canLookupClients?: boolean;
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export default function CreateSalesAttendance({
  open,
  onOpenChangeAction,
  formData,
  onChangeAction,
  userDetails,
  fetchAccountAction,
  setFormAction,
  canLookupClients = true,
}: CreateAttendanceProps) {
  /* Single source of truth for the whole drawer: when the admin has turned
     client lookup off, nothing below should query for or render a client. */
  const clientLookupOn = canLookupClients;
  const locationRef = useRef<LocationVerifyHandle>(null);
  const [fixReady, setFixReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [faceData, setFaceData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [siteVisitAccounts, setSiteVisitAccounts] = useState<{ company_name: string }[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [siteVisitAccountsCount, setSiteVisitAccountsCount] = useState(0);

  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [loginCountToday, setLoginCountToday] = useState<number>(0);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [clientType, setClientType] = useState<"New Client" | "Existing Client" | "">("");

  const [selectMenuOpen, setSelectMenuOpen] = useState(false);

  /* ── Reset on open ── */
  useEffect(() => {
    if (!open) return;
    setCapturedImage(null);
    setClientType("");
    setFixReady(false);
  }, [open]);

  /* ── Geolocation ──
     Detection, the accuracy badge, the geofence verdict and the map all live
     in LocationVerify (shared with CreateAttendance — the two copies had
     already drifted apart). This sheet passes the client being visited, which
     is what makes the fence lookup possible.

     onLocationResolved is memoised because LocationVerify re-runs detection
     whenever the callback identity changes. */
const onLocationResolved = useCallback(
    (fix: GeoFix, address: string) => {
      setFixReady(true);
      // A New Client has no address on file yet, so the detected one is the
      // best starting point available. Existing clients keep theirs.
      if (clientType === "New Client") onChangeAction("address", address);
    },
    [clientType, onChangeAction]
  );

  /* The fence is only meaningful once a client is chosen. Keying the card on
     clientType + SiteVisitAccount makes it re-detect when the target changes,
     which is required — the previous site had a different boundary. */
  const fenceTarget =
    clientType === "New Client"
      ? (formData.company_name || null)
      : (formData.SiteVisitAccount || null);

  /* ── Helper functions for last status cache ── */
  const getLastStatusCacheKey = () => {
    // Create key with today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    return `last-status-${userDetails.ReferenceID}-${today}`;
  };

  const saveLastStatusToCache = (status: string | null) => {
    try {
      const cacheData = {
        status,
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
      const prefix = `last-status-${userDetails.ReferenceID}-`;
      
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

  /* ── Login Summary — fetch ONCE when dialog opens ── */
  /* ── Login Summary — fetch ONCE when dialog opens ── */
  useEffect(() => {
    if (!open || !userDetails.ReferenceID) {
      setLoadingStatus(true);
      return;
    }

    setLoadingStatus(true);
    
    // First try to load from cache for immediate display
    const cachedStatus = loadLastStatusFromCache();
    if (cachedStatus) {
      setLastStatus(cachedStatus.status);
      const nextAction = cachedStatus.status === "Login" ? "Logout" : "Login";
      onChangeAction("Status", nextAction);
    }

    fetch(`/api/ModuleSales/Activity/LastStatus?referenceId=${userDetails.ReferenceID}&type=Client Visit`, {
      credentials: "include", cache: "no-store"
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch status");
        return res.json();
      })
      .then((data) => {
        // API returns { lastStatus, lastTime }
        const status = data.lastStatus ?? null;
        setLastStatus(status);

        const nextAction = status === "Login" ? "Logout" : "Login";
        onChangeAction("Status", nextAction);
        
        // Save to cache
        saveLastStatusToCache(status);
      })
      .catch(() => {
        // If fetch fails, use cached status if available
        if (!cachedStatus) {
          setLastStatus(null);
          onChangeAction("Status", "Login");
          setLoginCountToday(0);
          saveLastStatusToCache(null);
        }
      })
      .finally(() => setLoadingStatus(false));

    // ⚠️ onChangeAction intentionally excluded — it's a prop function that
    // changes reference every render and would cause an infinite fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userDetails.ReferenceID]);

  // Helper function to get storage key
  const getStorageKey = () => {
    return `client-list-${userDetails.ReferenceID}-${userDetails.Role}`;
  };

  // Function to save accounts to localStorage
  const saveAccountsToLocalStorage = (data: any[], count: number) => {
    try {
      const storageData = {
        data,
        count,
        timestamp: Date.now()
      };
      localStorage.setItem(getStorageKey(), JSON.stringify(storageData));
    } catch (e) {
      console.error("Failed to save accounts to localStorage:", e);
    }
  };

  // Function to load accounts from localStorage
  const loadAccountsFromLocalStorage = () => {
    try {
      const stored = localStorage.getItem(getStorageKey());
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error("Failed to load accounts from localStorage:", e);
    }
    return null;
  };

  /* ── Fetch accounts when Existing Client selected ── */
  useEffect(() => {
    if (!open || clientType !== "Existing Client" || !clientLookupOn) {
      setSiteVisitAccounts([]);
      setSiteVisitAccountsCount(0);
      setAccountsError(null);
      setLoadingAccounts(false);
      return;
    }
    if (!userDetails.ReferenceID) {
      setAccountsError("Missing ReferenceID");
      setLoadingAccounts(false);
      return;
    }
    setLoadingAccounts(true);
    setAccountsError(null);

    // First, try to load from localStorage for immediate display
    const cachedData = loadAccountsFromLocalStorage();
    if (cachedData) {
      setSiteVisitAccounts(cachedData.data || []);
      setSiteVisitAccountsCount(cachedData.count || 0);
    }

    const fetchAccounts = (url: string) => {
      fetch(url)
        .then((r) => r.json())
        .then((json) => {
          if (json.success) {
            const data = json.data || [];
            const count = json.count || data.length || 0;
            setSiteVisitAccounts(data);
            setSiteVisitAccountsCount(count);
            setAccountsError(null);
            // Save fresh data to localStorage
            saveAccountsToLocalStorage(data, count);
          } else {
            // If fetch fails but we have cached data, keep it
            if (!cachedData) {
              setSiteVisitAccounts([]);
              setSiteVisitAccountsCount(0);
            }
            setAccountsError(json.error || "No accounts found");
          }
        })
        .catch(() => {
          // If fetch fails but we have cached data, that's okay!
          if (!cachedData) {
            setSiteVisitAccounts([]);
            setSiteVisitAccountsCount(0);
            setAccountsError("Error fetching accounts");
          } else {
            setAccountsError(null); // No error if we have cached data
          }
        })
        .finally(() => setLoadingAccounts(false));
    };

    if (userDetails.Role === "Territory Sales Manager") {
      fetchAccounts(`/api/fetch-tsm?referenceid=${encodeURIComponent(userDetails.ReferenceID)}`);
    } else if (userDetails.Role === "Manager") {
      fetchAccounts(`/api/fetch-manager?referenceid=${encodeURIComponent(userDetails.ReferenceID)}`);
    } else {
      fetchAccounts(`/api/fetch-account?referenceid=${encodeURIComponent(userDetails.ReferenceID)}`);
    }
  }, [open, clientType, userDetails.Role, userDetails.ReferenceID]);

  /* ── Submit ── */
  const handleCreate = async () => {
    if (!capturedImage) return toast.error("Please capture a photo first.");
    if (formData.Status === "Logout" && clientLookupOn && !clientType)
      return toast.error("Please select client type.");
    if (formData.Status === "Logout" && clientType === "Existing Client" && !formData.SiteVisitAccount) {
      return toast.error("Please select a company.");
    }

    /* Local half of the out-of-fence requirement. AddLog enforces the same
       rule server-side — this copy exists only so the agent is told why
       before the round trip, not after it. */
    const pendingFix = locationRef.current?.getFix() ?? null;
    if (!pendingFix) return toast.error("Location not ready yet. Please wait.");
    const pendingAudit = locationRef.current?.getAudit();
    if (pendingAudit?.flag === "outside_geofence" && !formData.Remarks?.trim()) {
      return toast.error(
        "This location is outside the client's boundary. Please add a short note in Remarks explaining why."
      );
    }

    // Save the new status to cache immediately for offline use
    const newStatus = formData.Status;
    saveLastStatusToCache(newStatus);
    setLastStatus(newStatus);
    
    // Update the next status
    const nextAction = newStatus === "Login" ? "Logout" : "Login";
    onChangeAction("Status", nextAction);

    setLoading(true);

    /* ── Client-site geofence ────────────────────────────────────
       An out-of-fence visit is NOT refused. It is warned in the sheet, and
       AddLog records it as outside_geofence after demanding a photo and
       remarks. Blocking outright would be wrong here: an agent legitimately
       standing near a client is not "away from the office", and the office
       fence below would refuse a visit for the wrong reason.

       The office fence is therefore only applied to a Clock In — the same
       rule CreateAttendance uses, so the two sheets agree. */
    const fix = locationRef.current?.getFix() ?? null;
    const geo = locationRef.current?.getAudit() ?? {
      accuracyM: null,
      source: null,
      flag: null,
      distanceM: null,
      siteName: null,
    };

    if (newStatus === "Login") {
      try {
        const geofence = await fetchGeofenceConfig();
        const within = fix ? isWithinGeofence(fix.lat, fix.lng, geofence) : null;
        if (within === false) {
          toast.error("⚠️ You are outside the allowed area. Please move closer to the office.", { duration: 6000 });
          setLoading(false);
          return;
        }
      } catch { /* non-critical */ }
    }

    // ── Compress photo ────────────────────────────────────────────────────
    let photo = capturedImage!;
    try { photo = await compressImage(capturedImage!); } catch { /* use original */ }

    const basePayload = {
      ...formData,
      Type: "Client Visit",
      Location:  locationRef.current?.getAddress() || "",
      Latitude:  fix?.lat ?? null,
      Longitude: fix?.lng ?? null,
      FaceData:  faceData,
      manager:   userDetails.Manager, // Pass manager from userDetails
      type_client: clientType,
      /* What the fix was. GeoFlag is not sent — the server derives it from
         its own fence lookup, so a tampered client cannot mark itself clean. */
      GeoAccuracyM: geo.accuracyM,
      GeoSource:    geo.source,
    };

    const resetForm = () => {
      fetchAccountAction();
      setFormAction({
        ReferenceID: userDetails.ReferenceID,
        Email: userDetails.Email,
        TSM: userDetails.TSM,
        Type: "Client Visit",
        Status: "",
        PhotoURL: "",
        Remarks: "",
        SiteVisitAccount: "",
        company_name: "",
        contact_person: "",
        contact_number: "",
        email_address: "",
        address: "",
      });
      setCapturedImage(null);
      onOpenChangeAction(false);
    };

    try {
      if (!navigator.onLine) {
        // ── Offline: queue with base64 photo ──────────────────────────────
        await enqueuePendingLog({ ...basePayload, PhotoURL: photo });
        toast.success("Saved offline — will sync when you're back online.", {
          duration: 4000,
        });
        // Dispatch custom event to trigger pending count refresh
        window.dispatchEvent(new CustomEvent("acculog:sync"));
        resetForm();
        return;
      }

      // ── Online: upload photo first ─────────────────────────────────────
      let photoURL: string;
      try {
        photoURL = await uploadToCloudinary(photo);
      } catch {
        // Upload failed — queue with base64 for later
        await enqueuePendingLog({ ...basePayload, PhotoURL: photo });
        toast.success("Photo upload failed — saved offline. Will sync when connection improves.", {
          duration: 4000,
        });
        // Dispatch custom event to trigger pending count refresh
        window.dispatchEvent(new CustomEvent("acculog:sync"));
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
        if (!res.ok) throw new Error("Failed to save attendance");
        toast.success("Attendance created!");
        if ("vibrate" in navigator) navigator.vibrate([50, 30, 50]);
        resetForm();
      } catch {
        // API failed after upload — queue with Cloudinary URL (no re-upload)
        await enqueuePendingLog({ ...basePayload, PhotoURL: photoURL });
        toast.success("Saved offline — will sync when connection returns.", {
          duration: 4000,
        });
        // Dispatch custom event to trigger pending count refresh
        window.dispatchEvent(new CustomEvent("acculog:sync"));
        resetForm();
      }
    } catch (err: any) {
      toast.error(err?.message || "Error saving attendance.");
    } finally {
      setLoading(false);
    }
  };

  // Determine UI state
  const isLogout = lastStatus === "Login";
  const nextAction = formData.Status; // Use the Status from formData which we set in useEffect
  /* Client requirements only apply when the admin has left client lookup on.
     With it off, the agent must still be able to clock out.

     A poor GPS fix does NOT disable submit — the spec wants the agent warned
     and allowed through, with the record flagged for review. Only a MISSING
     fix blocks, because then there is nothing to record. */
  const isSubmitDisabled =
    loading ||
    !capturedImage ||
    loadingStatus ||
    !fixReady ||
    (clientLookupOn && formData.Status === "Logout" && !clientType) ||
    (clientLookupOn && formData.Status === "Logout" && clientType === "Existing Client" && !formData.SiteVisitAccount) ||
    (clientLookupOn && formData.Status === "Logout" && clientType === "New Client" && !formData.company_name);
  /* ── Render: bottom drawer (not a centred dialog) ── */
  // The brief calls for a slide-up bottom sheet with a drag handle. All the
  // attributes must precede the `>` that opens the children — JSX does not
  // allow attributes after children start.
  return (
    <MintDrawer
      open={open}
      onOpenChange={onOpenChangeAction}
      onClose={() => onOpenChangeAction(false)}
      title="Site Visit Log"
      description="Client attendance entry"
      tone="clay"
      header={
        <>
          {/* Orange accent: this is the GPS / site-visit flow */}
          <div
            className="px-5 pt-2 pb-5 flex-shrink-0"
            style={{
              background:
                "linear-gradient(180deg, var(--clay-soft) 0%, var(--card) 100%)",
            }}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onOpenChangeAction(false)}
                aria-label="Close"
                className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                style={{ background: "var(--card)", color: "var(--clay-ink)" }}
              >
                <ArrowLeft size={17} />
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="text-[17px] font-black text-[var(--text)] leading-tight">
                  Site Visit Log
                </h2>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                  Client attendance entry
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] font-bold text-[var(--text-muted)]">
                  {new Date().toLocaleDateString("en-PH", {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                <p className="mint-num text-[13px] font-black text-[var(--text)]">
                  {new Date().toLocaleTimeString("en-PH", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>

            {/* Status summary — says what this submission will actually do */}
            <div className="flex items-center gap-2.5 mt-4">
              <div
                className="flex-1 rounded-[var(--r-card)] px-3.5 py-2.5 flex items-center justify-between"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <span className="flex items-center gap-2">
                  {loadingStatus ? (
                    <Loader2
                      size={13}
                      className="animate-spin"
                      style={{ color: "var(--clay)" }}
                    />
                  ) : (
                    <span
                      className="w-2 h-2 rounded-full animate-pulse-soft"
                      style={{ background: isLogout ? "var(--clay)" : "var(--mint)" }}
                    />
                  )}
                  <span className="text-[11px] font-extrabold text-[var(--text-muted)]">
                    Next action
                  </span>
                </span>
                <span
                  className="text-[12.5px] font-black"
                  style={{
                    color: isLogout ? "var(--clay-ink)" : "var(--mint-strong)",
                  }}
                >
                  {loadingStatus
                    ? "Loading…"
                    : nextAction === "Logout"
                      ? "Time Out"
                      : "Time In"}
                </span>
              </div>
              <div
                className="rounded-[var(--r-card)] px-3.5 py-2.5 text-center"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <p className="text-[10px] font-extrabold text-[var(--text-muted)]">
                  Today
                </p>
                <p className="mint-num text-[15px] font-black text-[var(--text)]">
                  {loginCountToday}
                </p>
              </div>
            </div>
          </div>
        </>
      }
      // The account <Select> renders a floating menu, so let it escape the
      // scroll container while it's open.
      bodyClassName={selectMenuOpen ? "overflow-visible" : undefined}
      // Sticky, so Submit is always one thumb-tap away even mid-form.
      footer={
        capturedImage && !loadingStatus ? (
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
              variant={isLogout ? "clockout" : "primary"}
              icon={isLogout ? <LogOut size={19} /> : <LogIn size={19} />}
              loading={loading}
              disabled={isSubmitDisabled}
              onClick={handleCreate}
            >
              {navigator.onLine
                ? isLogout
                  ? "Submit Time Out"
                  : "Submit Time In"
                : isLogout
                  ? "Save Offline (Time Out)"
                  : "Save Offline (Time In)"}
            </MintButton>
            <p className="text-center text-[11px] font-semibold text-[var(--text-muted)] mt-2.5 leading-relaxed">
              {navigator.onLine
                ? isLogout
                  ? "This closes your visit at this client. Your supervisor sees the GPS pin, timestamp and photo."
                  : "This logs your arrival at the client. Log the Time Out when you leave."
                : "Saved to this phone — it uploads automatically once you have signal."}
            </p>
          </div>
        ) : undefined
      }
    >
      <div
        className="flex flex-col gap-4 p-5"
        style={{ background: "var(--bg)" }}
      >
        {/* Location first — the spec asks for it at the top, and an agent who is
            at the wrong client should find out before they take the photo. The
            fence only resolves once a client is chosen, hence fenceTarget. */}
        <LocationVerify
          ref={locationRef}
          open={open}
          siteName={fenceTarget}
          accent="clay"
          onResolved={onLocationResolved}
        />

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

        {/* Everything below needs a photo first */}
        {capturedImage && !loadingStatus && (
          <>
            {/* Client type — only meaningful on Logout, and only when the admin has
                left client lookup enabled for this user. */}
            {formData.Status === "Logout" && clientLookupOn && (
              <div>
                <MintLabel>Client Type</MintLabel>
                <div className="grid grid-cols-2 gap-2.5">
                  {(["New Client", "Existing Client"] as const).map((t) => {
                    const isSelected = clientType === t;
                    const isNew = t === "New Client";
                    // New client = info blue, existing = mint. Both stay legible.
                    const accent = isNew ? "var(--info)" : "var(--mint-strong)";
                    const accentBg = isNew ? "var(--info-soft)" : "var(--mint-soft)";
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          setClientType(t);
                          if (t === "New Client") {
                            onChangeAction("SiteVisitAccount", "");
                            /* Pre-fill with the detected address. Read from the
                               card's handle rather than a local mirror, so the
                               prefill and the submitted Location cannot differ. */
                            const detected = locationRef.current?.getAddress();
                            if (detected) onChangeAction("address", detected);
                          } else {
                            const next = lastStatus === "Login" ? "Logout" : "Login";
                            onChangeAction("Status", next);
                          }
                        }}
                        className="mint-tap rounded-[var(--r-card)] border-2 p-3.5 flex flex-col items-center gap-2"
                        style={{
                          background: isSelected ? accentBg : "var(--card)",
                          borderColor: isSelected ? accent : "var(--border)",
                        }}
                      >
                        {isNew ? (
                          <UserPlus
                            size={20}
                            style={{
                              color: isSelected ? accent : "var(--text-faint)",
                            }}
                          />
                        ) : (
                          <Users
                            size={20}
                            style={{
                              color: isSelected ? accent : "var(--text-faint)",
                            }}
                          />
                        )}
                        <span
                          className="text-[12.5px] font-extrabold"
                          style={{
                            color: isSelected ? accent : "var(--text-muted)",
                          }}
                        >
                          {t}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-2 leading-relaxed">
                  {clientType === "New Client"
                    ? "Add the company's details so your territory records stay complete."
                    : "Pick the account you're visiting so it links to your existing client."}
                </p>
              </div>
            )}

            {/* New client details */}
            {formData.Status === "Logout" && clientLookupOn && clientType === "New Client" && (
              <div className="flex flex-col gap-3">
                <div>
                  <MintLabel>Company Name</MintLabel>
                  <MintInput
                    type="text"
                    value={formData.company_name || ""}
                    onChange={(e) => onChangeAction("company_name", e.target.value)}
                    placeholder="Enter company name…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <MintLabel>Contact Person</MintLabel>
                    <MintInput
                      type="text"
                      value={formData.contact_person || ""}
                      onChange={(e) => onChangeAction("contact_person", e.target.value)}
                      placeholder="Name…"
                      className="px-3 text-[12.5px]"
                    />
                  </div>
                  <div>
                    <MintLabel>Contact Number</MintLabel>
                    <MintInput
                      type="text"
                      value={formData.contact_number || ""}
                      onChange={(e) => onChangeAction("contact_number", e.target.value)}
                      placeholder="Phone…"
                      className="px-3 text-[12.5px]"
                    />
                  </div>
                </div>
                <div>
                  <MintLabel>Email Address</MintLabel>
                  <MintInput
                    type="email"
                    value={formData.email_address || ""}
                    onChange={(e) => onChangeAction("email_address", e.target.value)}
                    placeholder="client@email.com…"
                  />
                </div>
                <div>
                  <MintLabel>Address</MintLabel>
                  <MintInput
                    textarea
                    rows={2}
                    value={formData.address || ""}
                    onChange={(e) => onChangeAction("address", e.target.value)}
                    placeholder="Company address…"
                  />
                </div>
              </div>
            )}

            {/* Existing client — account picker */}
            {formData.Status === "Logout" && clientLookupOn && clientType === "Existing Client" && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Site Visit Account
                    </span>
                    {!navigator.onLine && siteVisitAccounts.length > 0 && (
                      <MintPill tone="clay">Offline</MintPill>
                    )}
                  </div>
                  {siteVisitAccountsCount > 0 && (
                    <MintPill tone="mint">
                      {siteVisitAccountsCount} accounts
                    </MintPill>
                  )}
                </div>

                {loadingAccounts ? (
                  <div
                    className="rounded-[var(--r-card)] px-4 py-4 flex items-center gap-3"
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <Loader2
                      size={16}
                      className="animate-spin"
                      style={{ color: "var(--mint)" }}
                    />
                    <span className="text-[13px] font-semibold text-[var(--text-muted)]">
                      Loading accounts…
                    </span>
                  </div>
                ) : accountsError ? (
                  <div
                    className="rounded-[var(--r-card)] px-4 py-3 flex items-start gap-2"
                    style={{ background: "var(--alert-soft)" }}
                  >
                    <AlertCircle
                      size={15}
                      style={{ color: "var(--alert-ink)" }}
                      className="shrink-0 mt-px"
                    />
                    <span className="text-[12px] font-bold text-[var(--alert-ink)]">
                      {accountsError}
                    </span>
                  </div>
                ) : (
                  <div
                    className="rounded-[var(--r-card)] relative"
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <Select
                      options={siteVisitAccounts.map((a) => ({
                        value: a.company_name,
                        label: a.company_name,
                      }))}
                      value={
                        formData.SiteVisitAccount
                          ? {
                              value: formData.SiteVisitAccount,
                              label: formData.SiteVisitAccount,
                            }
                          : null
                      }
                      onChange={(s) => onChangeAction("SiteVisitAccount", s?.value || "")}
                      placeholder="Search company…"
                      classNamePrefix="mb-select"
                      onMenuOpen={() => setSelectMenuOpen(true)}
                      onMenuClose={() => setSelectMenuOpen(false)}
                      styles={{
                        control: (base) => ({
                          ...base,
                          border: "none",
                          boxShadow: "none",
                          borderRadius: "16px",
                          padding: "4px 6px",
                          fontSize: "13px",
                          backgroundColor: "transparent",
                          cursor: "pointer",
                        }),
                        menu: (base) => ({
                          ...base,
                          borderRadius: "16px",
                          overflow: "hidden",
                          boxShadow: "0 8px 32px rgba(15,23,42,.12)",
                          border: "1px solid var(--border)",
                          fontSize: "13px",
                          zIndex: 100,
                        }),
                        menuList: (base) => ({
                          ...base,
                          maxHeight: "200px",
                        }),
                        option: (base, state) => ({
                          ...base,
                          backgroundColor: state.isSelected
                            ? "var(--mint-btn)"
                            : state.isFocused
                              ? "var(--mint-soft)"
                              : "var(--card)",
                          color: state.isSelected ? "white" : "var(--text)",
                          fontWeight: state.isSelected ? 700 : 600,
                          padding: "12px 16px",
                          cursor: "pointer",
                        }),
                        placeholder: (base) => ({
                          ...base,
                          color: "var(--text-faint)",
                          fontSize: "13px",
                        }),
                        singleValue: (base) => ({
                          ...base,
                          color: "var(--text)",
                          fontWeight: 700,
                        }),
                      }}
                    />
                  </div>
                )}
              </div>
            )}

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
                placeholder="Add notes or feedback (optional)"
              />
            </div>

            {/* Location moved to the top of the sheet - see LocationVerify above. */}
          </>
        )}

        {loadingStatus && capturedImage && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 size={30} className="animate-spin" style={{ color: "var(--mint)" }} />
            <p className="text-[13px] font-bold text-[var(--text-muted)]">
              Checking your current status…
            </p>
          </div>
        )}
      </div>
    </MintDrawer>
  );
}
