"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import Camera from "./camera";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  ArrowLeft, MapPin, CheckCircle2, LogIn, LogOut,
  UserPlus, Users, FileText, AlertCircle,
} from "lucide-react";
import Select from "react-select";

const ManualLocationPicker = dynamic(() => import("./manual-location-picker"), { ssr: false });
import { enqueuePendingLog } from "@/lib/offline-store";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { compressImage } from "@/lib/image-compress";
import { fetchGeofenceConfig, isWithinGeofence } from "@/lib/geofence";
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
}

interface UserDetails {
  ReferenceID: string;
  TSM: string;
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
}: CreateAttendanceProps) {
  const [locationAddress, setLocationAddress] = useState("Fetching location...");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [manualLat, setManualLat] = useState<number | null>(null);
  const [manualLng, setManualLng] = useState<number | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [faceData, setFaceData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showMap, setShowMap] = useState(false);

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
    setManualLat(null);
    setManualLng(null);
    setCapturedImage(null);
    setClientType("");
    setShowMap(false);
  }, [open]);

  /* ── Geolocation ── */
  useEffect(() => {
    if (!open) return;

    const getLocation = () => {
      setLocationAddress("Fetching location...");

      const options = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      };

      const success = (position: GeolocationPosition) => {
        const { latitude: lat, longitude: lng } = position.coords;
        setLatitude(lat);
        setLongitude(lng);

        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
          .then((r) => r.json())
          .then((d) => {
            const addr = d.display_name || "Location detected";
            setLocationAddress(addr);
          })
          .catch(() => setLocationAddress("Location detected (GPS OK)"));
      };

      const error = (err: GeolocationPositionError) => {
        // Retry with lower accuracy if high accuracy fails
        if (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE) {
          navigator.geolocation.getCurrentPosition(success,
            () => setLocationAddress("Location unavailable. Please check GPS."),
            { ...options, enableHighAccuracy: false, timeout: 10000 }
          );
        } else {
          setLocationAddress("Location permission denied or unavailable.");
        }
      };

      if (!navigator.geolocation) {
        setLocationAddress("Geolocation not supported by browser.");
        return;
      }

      navigator.geolocation.getCurrentPosition(success, error, options);
    };

    getLocation();
  }, [open]);

  /* ── Login Summary — fetch ONCE when dialog opens ── */
  /* ── Login Summary — fetch ONCE when dialog opens ── */
  useEffect(() => {
    if (!open || !userDetails.ReferenceID) {
      setLoadingStatus(true);
      return;
    }

    setLoadingStatus(true);
    fetch(`/api/ModuleSales/Activity/LastStatus?referenceId=${userDetails.ReferenceID}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch status");
        return res.json();
      })
      .then((data) => {
        if (!data) {
          // No activity today — first action is Login
          setLastStatus(null);
          onChangeAction("Status", "Login");
          setLoginCountToday(0);
          return;
        }

        // API returns { Status, date_created }
        const status = data.Status ?? null;
        setLastStatus(status);

        const nextAction = status === "Login" ? "Logout" : "Login";
        onChangeAction("Status", nextAction);
      })
      .catch(() => {
        setLastStatus(null);
        onChangeAction("Status", "Login");
        setLoginCountToday(0);
      })
      .finally(() => setLoadingStatus(false));

    // ⚠️ onChangeAction intentionally excluded — it's a prop function that
    // changes reference every render and would cause an infinite fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userDetails.ReferenceID]);

  /* ── Fetch accounts when Existing Client selected ── */
  useEffect(() => {
    if (!open || clientType !== "Existing Client") {
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

    const fetchAccounts = (url: string) => {
      fetch(url)
        .then((r) => r.json())
        .then((json) => {
          if (json.success) {
            setSiteVisitAccounts(json.data || []);
            setSiteVisitAccountsCount(json.count || json.data?.length || 0);
            setAccountsError(null);
          } else {
            setSiteVisitAccounts([]);
            setSiteVisitAccountsCount(0);
            setAccountsError(json.error || "No accounts found");
          }
        })
        .catch(() => setAccountsError("Error fetching accounts"))
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
    if (!clientType) return toast.error("Please select client type.");
    if (clientType === "Existing Client" && !formData.SiteVisitAccount) {
      return toast.error("Please select a company.");
    }
    if (locationAddress === "Fetching location...") return toast.error("Location not ready yet.");

    setLoading(true);

    // ── Geofence check ────────────────────────────────────────────────────
    if ((manualLat ?? latitude) !== null && (manualLng ?? longitude) !== null) {
      try {
        const geofence = await fetchGeofenceConfig();
        const within = isWithinGeofence(manualLat ?? latitude!, manualLng ?? longitude!, geofence);
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
      Location:  locationAddress,
      Latitude:  manualLat ?? latitude,
      Longitude: manualLng ?? longitude,
      FaceData:  faceData,
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
      });
      setCapturedImage(null);
      onOpenChangeAction(false);
    };

    try {
      if (!navigator.onLine) {
        // ── Offline: queue with base64 photo ──────────────────────────────
        await enqueuePendingLog({ ...basePayload, PhotoURL: photo });
        toast.success("Saved offline — will sync when you're back online.");
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
        toast.success("Photo upload failed — saved offline. Will sync when connection improves.");
        resetForm();
        return;
      }

      try {
        const res = await fetch("/api/ModuleSales/Activity/AddLog", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ ...basePayload, PhotoURL: photoURL }),
        });
        if (!res.ok) throw new Error("Failed to save attendance");
        toast.success("Attendance created!");
        if ("vibrate" in navigator) navigator.vibrate([50, 30, 50]);
        resetForm();
      } catch {
        // API failed after upload — queue with Cloudinary URL (no re-upload)
        await enqueuePendingLog({ ...basePayload, PhotoURL: photoURL });
        toast.success("Saved offline — will sync when connection returns.");
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
  const isSubmitDisabled =
    loading ||
    !capturedImage ||
    !clientType ||
    loadingStatus ||
    locationAddress === "Fetching location..." ||
    locationAddress.includes("unavailable") ||
    (clientType === "Existing Client" && !formData.SiteVisitAccount);

  /* ── Render ── */
  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent
        className="p-0 rounded-[28px] max-w-sm w-full mx-auto overflow-hidden border-0 shadow-2xl max-h-[92vh] flex flex-col"
        onPointerDownOutside={(e) => {
          if (selectMenuOpen) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (selectMenuOpen) e.preventDefault();
        }}
      >
        {/* ── Header ── */}
        <div className="bg-brand-primary px-6 pt-5 pb-5 flex-shrink-0">
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => onOpenChangeAction(false)}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
            >
              <ArrowLeft size={15} />
            </button>
            <div className="flex-1">
              <h2 className="text-white font-semibold text-base leading-tight">Site Visit Log</h2>
              <p className="text-white/65 text-[11px] mt-0.5">Client attendance entry</p>
            </div>
            <div className="text-right">
              <p className="text-white/65 text-[11px]">
                {new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
              </p>
              <p className="text-white font-semibold text-[13px]">
                {new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>

          {/* Status summary pill */}
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-white/15 rounded-2xl px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {loadingStatus ? (
                  <div className="w-2 h-2 rounded-full bg-yellow-300 animate-pulse" />
                ) : (
                  <div
                    className={`w-2 h-2 rounded-full ${isLogout ? "bg-red-300" : "bg-green-300"
                      } animate-pulse`}
                  />
                )}
                <span className="text-white/75 text-[11px] font-medium">Next action</span>
              </div>
              <span
                className={`text-[12px] font-bold ${loadingStatus
                  ? "text-yellow-200"
                  : isLogout
                    ? "text-red-200"
                    : "text-green-200"
                  }`}
              >
                {loadingStatus ? "Loading..." : nextAction || "—"}
              </span>
            </div>
            <div className="bg-white/15 rounded-2xl px-4 py-2.5 text-center">
              <p className="text-white/65 text-[10px]">Today</p>
              <p className="text-white font-bold text-[15px]">{loginCountToday}</p>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto flex-1 bg-brand-bg">
          <div className="flex flex-col gap-4 p-5">

            {/* Camera */}
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                📷 Photo Verification
              </p>
              <Camera
                registeredDescriptors={userDetails.faceDescriptors}
                skipFaceVerification={userDetails.faceVerificationEnabled === false}
                onCaptureAction={(img, face) => {
                  setCapturedImage(img);
                  setFaceData(face);
                }}
              />
              {capturedImage && (
                <div className="mt-2 flex items-center gap-2 bg-[#EEF7F2] rounded-xl px-3 py-2">
                  <CheckCircle2 size={14} className="text-[#1A7A4A]" />
                  <span className="text-[12px] font-semibold text-[#1A7A4A]">
                    Photo captured successfully
                  </span>
                </div>
              )}
            </div>

            {/* Post-capture form */}
            {capturedImage && !loadingStatus && (
              <>
                {/* Client Type toggle */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    Client Type
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {(["New Client", "Existing Client"] as const).map((t) => {
                      const isSelected = clientType === t;
                      const isNew = t === "New Client";
                      return (
                        <button
                          key={t}
                          onClick={() => {
                            setClientType(t);
                            if (t === "New Client") onChangeAction("SiteVisitAccount", "");
                          }}
                          className={[
                            "rounded-2xl border-[1.5px] p-4 flex flex-col items-center gap-2 transition-all",
                            isSelected
                              ? isNew
                                ? "bg-[#E6F1FB] border-[#185FA5]"
                                : "bg-[#EEF7F2] border-[#1A7A4A]"
                              : "bg-white border-gray-200 hover:border-gray-300",
                          ].join(" ")}
                        >
                          {isNew ? (
                            <UserPlus
                              size={20}
                              className={isSelected ? "text-[#185FA5]" : "text-gray-400"}
                            />
                          ) : (
                            <Users
                              size={20}
                              className={isSelected ? "text-[#1A7A4A]" : "text-gray-400"}
                            />
                          )}
                          <span
                            className={[
                              "text-[13px] font-semibold",
                              isSelected
                                ? isNew
                                  ? "text-[#185FA5]"
                                  : "text-[#1A7A4A]"
                                : "text-gray-700",
                            ].join(" ")}
                          >
                            {t}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Existing Client — account selector */}
                {clientType === "Existing Client" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                        Site Visit Account
                      </p>
                      {siteVisitAccountsCount > 0 && (
                        <span className="text-[11px] font-semibold text-[#1A7A4A] bg-[#EEF7F2] rounded-xl px-2.5 py-0.5">
                          {siteVisitAccountsCount} accounts
                        </span>
                      )}
                    </div>

                    {loadingAccounts ? (
                      <div className="bg-white rounded-2xl border border-gray-200 px-4 py-4 flex items-center gap-3">
                        <div className="w-4 h-4 border-2 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
                        <span className="text-[13px] text-gray-400">Loading accounts...</span>
                      </div>
                    ) : accountsError ? (
                      <div className="bg-brand-light border border-red-200 rounded-2xl px-4 py-3 flex items-center gap-2">
                        <AlertCircle size={14} className="text-brand-primary flex-shrink-0" />
                        <span className="text-[12px] text-brand-primary">{accountsError}</span>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-gray-200 bg-white">
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
                          placeholder="Search company..."
                          classNamePrefix="mb-select"
                          menuPortalTarget={
                            typeof document !== "undefined" ? document.body : null
                          }
                          menuPosition="fixed"
                          onMenuOpen={() => setSelectMenuOpen(true)}
                          onMenuClose={() => setSelectMenuOpen(false)}
                          styles={{
                            menuPortal: (base) => ({ ...base, zIndex: 9999 }),
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
                              boxShadow: "0 8px 32px rgba(26,10,11,0.12)",
                              border: "1px solid #EDE5E1",
                              fontSize: "13px",
                            }),
                            option: (base, state) => ({
                              ...base,
                              backgroundColor: state.isSelected
                                ? "var(--brand-primary)"
                                : state.isFocused
                                  ? "var(--brand-light)"
                                  : "white",
                              color: state.isSelected ? "white" : "#1A0A0B",
                              padding: "10px 16px",
                              cursor: "pointer",
                            }),
                            placeholder: (base) => ({
                              ...base,
                              color: "#A89898",
                              fontSize: "13px",
                            }),
                            singleValue: (base) => ({
                              ...base,
                              color: "#1A0A0B",
                              fontWeight: 600,
                            }),
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Remarks */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <FileText size={11} /> Remarks
                  </p>
                  <textarea
                    value={formData.Remarks}
                    onChange={(e) => onChangeAction("Remarks", e.target.value)}
                    placeholder="Add notes or feedback (optional)..."
                    rows={3}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-800 placeholder:text-gray-300 resize-none outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                  />
                </div>

                {/* Location */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    📍 Location
                  </p>
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 flex gap-3 items-start">
                    <div className="w-9 h-9 rounded-xl bg-brand-light flex items-center justify-center flex-shrink-0">
                      <MapPin size={16} className="text-brand-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-brand-primary uppercase tracking-wider mb-1">
                        Detected Location
                      </p>
                      <p className="text-[12px] text-gray-500 leading-snug">{locationAddress}</p>
                      <button
                        onClick={() => {
                          if (!navigator.onLine) {
                            toast.error("Manual map is not available offline.");
                            return;
                          }
                          setShowMap(!showMap);
                        }}
                        className="mt-2 text-[11px] font-semibold text-brand-primary hover:underline"
                      >
                        {showMap ? "Hide map" : "⚙ Set manually →"}
                      </button>
                    </div>
                  </div>
                  {showMap && navigator.onLine && (
                    <div className="mt-2 rounded-2xl overflow-hidden border border-gray-200">
                      <ManualLocationPicker
                        latitude={manualLat ?? latitude}
                        longitude={manualLng ?? longitude}
                        onChange={(lat, lng, addr) => {
                          setManualLat(lat);
                          setManualLng(lng);
                          if (addr) setLocationAddress(addr);
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Submit */}
                <button
                  onClick={handleCreate}
                  disabled={isSubmitDisabled}
                  className={[
                    "w-full rounded-2xl py-4 text-[15px] font-semibold flex items-center justify-center gap-2 transition-all",
                    isSubmitDisabled
                      ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                      : isLogout
                        ? "bg-brand-primary text-white hover:bg-brand-primary-hover active:scale-[0.98] shadow-lg shadow-brand-primary/20"
                        : "bg-[#1A7A4A] text-white hover:bg-[#155f38] active:scale-[0.98] shadow-lg shadow-green-200",
                  ].join(" ")}
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : isLogout ? (
                    <>
                      <LogOut size={16} />
                      {navigator.onLine ? "Logout" : "Save Offline (Logout)"}
                    </>
                  ) : (
                    <>
                      <LogIn size={16} />
                      {navigator.onLine ? "Login" : "Save Offline (Login)"}
                    </>
                  )}
                </button>

                <p className="text-center text-[11px] text-gray-300 pb-2">
                  {navigator.onLine
                    ? "Submission will be recorded with timestamp & GPS location"
                    : "Will sync automatically when you're back online"}
                </p>
              </>
            )}

            {loadingStatus && capturedImage && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-8 h-8 border-3 border-brand-primary/20 border-t-brand-primary rounded-full animate-spin" />
                <p className="text-[13px] text-gray-500">Determining login status...</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}