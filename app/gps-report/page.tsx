"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UserProvider, useUser } from "@/contexts/UserContext";
import ProtectedPageWrapper from "@/components/protected-page-wrapper";
import { toast } from "sonner";
import {
  Camera,
  MapPin,
  Calendar,
  FileText,
  Send,
  X,
  ChevronLeft,
  Upload,
  Clock,
  Check,
  ImagePlus,
  Loader2,
} from "lucide-react";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { compressImage } from "@/lib/image-compress";
import {
  POOR_ACCURACY_MESSAGE,
  captureBestPosition,
  gradeAccuracy,
  reverseGeocode,
} from "@/lib/geo";
import type { FixSource } from "@/lib/geo";

interface UserDetails {
  UserId: string;
  Firstname: string;
  Lastname: string;
  Email: string;
  Role: string;
  Department: string;
  ReferenceID: string;
  TSM: string;
}

function GPSReportPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { userId } = useUser();
  const queryUserId = searchParams?.get("id") ?? "";

  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [loginDate, setLoginDate] = useState<string>("");
  const [logoutDate, setLogoutDate] = useState<string>("");
  const [remarks, setRemarks] = useState<string>("");
  const [gpsLocation, setGpsLocation] = useState<{
    lat: number;
    lng: number;
    address?: string;
    accuracyM?: number | null;
    source?: FixSource;
    stale?: boolean;
    note?: string;
  } | null>(null);
  const [gettingLocation, setGettingLocation] = useState(false);

  useEffect(() => {
    if (!queryUserId) {
      toast.error("User ID is missing.");
      return;
    }
    fetchUserDetails();
  }, [queryUserId]);

  const fetchUserDetails = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/user?id=${encodeURIComponent(queryUserId)}`);
      if (!res.ok) throw new Error("Failed to fetch user data");
      const data = await res.json();
      setUserDetails({
        UserId: data._id ?? "",
        Firstname: data.Firstname ?? "",
        Lastname: data.Lastname ?? "",
        Email: data.Email ?? "",
        Role: data.Role ?? "",
        Department: data.Department ?? "",
        ReferenceID: data.ReferenceID ?? "",
        TSM: data.TSM ?? "",
      });
    } catch (err) {
      toast.error("Failed to load user data.");
    } finally {
      setLoading(false);
    }
  };

  /* Uses the same engine as the attendance sheets (lib/geo.ts) rather than its
     own getCurrentPosition, for two reasons: the first reading from the radio
     stack is routinely 40-300 m out, and the accuracy figure is the only way
     the agent can tell a trustworthy fix from a guess. This page previously
     accepted the first reading and silently dropped coords.accuracy. */
  const getCurrentLocation = useCallback(async () => {
    setGettingLocation(true);

    const result = await captureBestPosition({ windowMs: 15_000 });

    if (!result.ok) {
      toast.error(result.message);
      setGettingLocation(false);
      return;
    }

    const fix = result.fix;
    const geo = await reverseGeocode(fix.lat, fix.lng);

    setGpsLocation({
      lat: fix.lat,
      lng: fix.lng,
      address: geo.address ?? undefined,
      accuracyM: fix.accuracyM,
      source: fix.source,
      stale: fix.stale,
      note: result.note,
    });
    setGettingLocation(false);

    if (gradeAccuracy(fix.accuracyM).warn) {
      toast.warning(`${POOR_ACCURACY_MESSAGE}`, { duration: 6000 });
    } else {
      toast.success("Location captured successfully!");
    }
  }, []);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    if (photos.length + files.length > 5) {
      toast.error("Maximum 5 photos allowed.");
      return;
    }

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} is not an image.`);
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} is too large. Max size is 5MB.`);
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotos((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userDetails) {
      toast.error("User details not loaded.");
      return;
    }

    if (photos.length === 0) {
      toast.error("Please upload at least one photo.");
      return;
    }

    if (!loginDate) {
      toast.error("Please select login date.");
      return;
    }

    if (!logoutDate) {
      toast.error("Please select logout date.");
      return;
    }

    if (!remarks.trim()) {
      toast.error("Please add remarks/reason.");
      return;
    }

    if (!gpsLocation) {
      toast.error("Please capture your GPS location.");
      return;
    }

    setSubmitting(true);
    
    try {
      // ── Upload photos to Cloudinary first (avoids 1MB body limit) ──────
      toast.info("Uploading photos...", { id: "gps-upload" });
      const uploadedUrls: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        try {
          let photo = photos[i];
          try { photo = await compressImage(photo); } catch { /* use original */ }
          const url = await uploadToCloudinary(photo);
          uploadedUrls.push(url);
        } catch {
          toast.dismiss("gps-upload");
          toast.error(`Failed to upload photo ${i + 1}. Please try again.`);
          setSubmitting(false);
          return;
        }
      }
      toast.dismiss("gps-upload");

      // Prepare payload with Cloudinary URLs instead of base64
      const payload = {
        ReferenceID: userDetails.ReferenceID,
        Email: userDetails.Email,
        TSM: userDetails.TSM,
        photos: uploadedUrls,
        loginDate,
        logoutDate,
        remarks,
        gpsLocation,
      };

      const res = await fetch("/api/gps-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success("GPS Report submitted successfully!");
        setPhotos([]);
        setLoginDate("");
        setLogoutDate("");
        setRemarks("");
        setGpsLocation(null);
        setTimeout(() => {
          router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
        }, 1500);
      } else {
        const errorData = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
        toast.error(errorData.error || `Failed to submit report (${res.status}).`);
      }
    } catch (err) {
      console.error("[GPS Report] submit error:", err);
      toast.error("Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const goBack = () => {
    router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
  };

  if (loading) {
    return (
      <div
        className="mint-ui mint-scope min-h-screen flex items-center justify-center"
        style={{
          background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--bg) 100%)",
        }}
        role="status"
        aria-label="Loading GPS report"
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={30} className="animate-spin" style={{ color: "var(--mint)" }} />
          <p className="text-[12.5px] font-bold" style={{ color: "var(--text-muted)" }}>
            Loading your details…
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="mint-ui mint-scope min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Header — soft mint gradient, never a solid red banner */}
      <div
        className="px-5 pt-12 pb-6 flex-shrink-0"
        style={{
          background:
            "linear-gradient(180deg, var(--mint-gradient) 0%, var(--bg) 100%)",
        }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            aria-label="Go back"
            className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 transition-colors active:scale-95"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-[20px] font-black text-[var(--text)] leading-tight">
              Submit GPS Report
            </h1>
            <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-0.5">
              Offline attendance verification
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto mint-scroll px-4 pt-5 pb-28">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Who you are */}
          {userDetails && (
            <div
              className="rounded-[var(--r-card-lg)] border p-4"
              style={{
                background: "var(--card)",
                borderColor: "var(--border)",
                boxShadow: "var(--sh-card)",
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                  style={{ background: "var(--mint-soft)" }}
                >
                  <FileText size={18} style={{ color: "var(--mint-strong)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-extrabold text-[var(--text)] truncate">
                    {userDetails.Firstname} {userDetails.Lastname}
                  </p>
                  <p className="text-[11.5px] font-semibold text-[var(--text-muted)] truncate">
                    {userDetails.Role} · {userDetails.ReferenceID}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Site photos */}
          <div
            className="rounded-[var(--r-card-lg)] border p-4"
            style={{
              background: "var(--card)",
              borderColor: "var(--border)",
              boxShadow: "var(--sh-card)",
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                style={{ background: "var(--info-soft)" }}
              >
                <Camera size={18} style={{ color: "var(--info)" }} />
              </div>
              <div className="min-w-0">
                <p className="text-[13.5px] font-extrabold text-[var(--text)]">
                  Site Photos
                </p>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)]">
                  Upload photos as proof — {photos.length} of 5 added
                </p>
              </div>
            </div>

            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                {photos.map((photo, index) => (
                  <div key={index} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo}
                      alt={`Site photo ${index + 1}`}
                      className="w-full h-24 object-cover rounded-[14px]"
                      style={{ border: "1px solid var(--border)" }}
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(index)}
                      aria-label={`Remove photo ${index + 1}`}
                      className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: "var(--alert)" }}
                    >
                      <X size={13} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {photos.length < 5 && (
              <label
                className="flex items-center justify-center gap-2 w-full min-h-[56px] border-2 border-dashed rounded-[var(--r-card)] cursor-pointer transition-colors"
                style={{ borderColor: "var(--border-strong)", background: "var(--card-alt)" }}
              >
                <ImagePlus size={18} style={{ color: "var(--mint)" }} />
                <span
                  className="text-[12.5px] font-extrabold"
                  style={{ color: "var(--mint-strong)" }}
                >
                  {photos.length === 0 ? "Add site photos" : "Add another photo"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </label>
            )}
          </div>

          {/* Time period */}
          <div
            className="rounded-[var(--r-card-lg)] border p-4"
            style={{
              background: "var(--card)",
              borderColor: "var(--border)",
              boxShadow: "var(--sh-card)",
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                style={{ background: "var(--mint-soft)" }}
              >
                <Calendar size={18} style={{ color: "var(--mint-strong)" }} />
              </div>
              <div className="min-w-0">
                <p className="text-[13.5px] font-extrabold text-[var(--text)]">
                  Time Period
                </p>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)]">
                  When did you visit the site?
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {(
                [
                  { label: "Login Date", value: loginDate, set: setLoginDate },
                  { label: "Logout Date", value: logoutDate, set: setLogoutDate },
                ] as const
              ).map((f) => (
                <label key={f.label} className="flex flex-col gap-1.5">
                  <span
                    className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] ml-1"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {f.label}
                  </span>
                  <div className="relative">
                    <Clock
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: "var(--text-faint)" }}
                    />
                    <input
                      type="datetime-local"
                      required
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                      className="w-full rounded-[14px] border pl-9 pr-3 text-[12px] font-semibold outline-none transition-colors"
                      style={{
                        minHeight: 48,
                        borderColor: "var(--border-strong)",
                        background: "var(--card)",
                        color: "var(--text)",
                      }}
                    />
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* GPS location */}
          <div
            className="rounded-[var(--r-card-lg)] border p-4"
            style={{
              background: "var(--card)",
              borderColor: "var(--border)",
              boxShadow: "var(--sh-card)",
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                style={{ background: "var(--clay-soft)" }}
              >
                <MapPin size={18} style={{ color: "var(--clay-ink)" }} />
              </div>
              <div className="min-w-0">
                <p className="text-[13.5px] font-extrabold text-[var(--text)]">
                  GPS Location
                </p>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)]">
                  {gpsLocation
                    ? "Location captured"
                    : "Capture your current location"}
                </p>
              </div>
            </div>

            {gpsLocation ? (
              <div
                className="rounded-[var(--r-card)] p-3"
                style={{ background: "var(--mint-soft)" }}
              >
                <p
                  className="text-[12.5px] font-extrabold flex items-center gap-1.5"
                  style={{ color: "var(--mint-strong)" }}
                >
                  <Check size={14} /> Location Captured
                  {gpsLocation.stale && " (last known)"}
                </p>

                {/* Accuracy badge. `good` is deliberately quiet — only a poor
                    fix interrupts, because 26-50 m is normal indoors and
                    alarming someone about it every shift trains them to
                    ignore the badge entirely. */}
                {gpsLocation.accuracyM != null && (
                  <div className="mt-1.5">
                    <span
                      className="text-[9.5px] font-extrabold px-1.5 py-[3px] rounded-full leading-none inline-block"
                      style={{
                        background: gradeAccuracy(gpsLocation.accuracyM).bg,
                        color: gradeAccuracy(gpsLocation.accuracyM).fg,
                      }}
                    >
                      {gradeAccuracy(gpsLocation.accuracyM).label} ·{" "}
                      {gradeAccuracy(gpsLocation.accuracyM).detail}
                    </span>
                  </div>
                )}

                <p
                  className="mint-num text-[11.5px] font-semibold mt-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  Lat: {gpsLocation.lat.toFixed(6)}, Lng: {gpsLocation.lng.toFixed(6)}
                </p>
                {gpsLocation.address && (
                  <p
                    className="text-[11.5px] font-semibold mt-1 leading-relaxed"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {gpsLocation.address}
                  </p>
                )}

                {gpsLocation.note && (
                  <p
                    className="text-[11px] font-bold mt-1.5 leading-relaxed"
                    style={{
                      color:
                        gpsLocation.accuracyM != null &&
                        gpsLocation.accuracyM > 50
                          ? "var(--amber-ink)"
                          : "var(--text-muted)",
                    }}
                  >
                    {gpsLocation.note}
                  </p>
                )}

                <button
                  type="button"
                  onClick={getCurrentLocation}
                  disabled={gettingLocation}
                  className="mt-2 min-h-[40px] text-[11.5px] font-extrabold"
                  style={{ color: "var(--mint-strong)" }}
                >
                  Update Location
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={getCurrentLocation}
                disabled={gettingLocation}
                className="w-full min-h-[52px] rounded-[var(--r-btn)] text-white font-extrabold text-[13.5px] flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: "var(--mint-btn)" }}
              >
                {gettingLocation ? (
                  <>
                    <Loader2 size={17} className="animate-spin" />
                    Getting Location…
                  </>
                ) : (
                  <>
                    <MapPin size={17} />
                    Capture GPS Location
                  </>
                )}
              </button>
            )}
          </div>

          {/* Remarks */}
          <div
            className="rounded-[var(--r-card-lg)] border p-4"
            style={{
              background: "var(--card)",
              borderColor: "var(--border)",
              boxShadow: "var(--sh-card)",
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                style={{ background: "var(--bg)" }}
              >
                <FileText size={18} style={{ color: "var(--text-faint)" }} />
              </div>
              <div className="min-w-0">
                <p className="text-[13.5px] font-extrabold text-[var(--text)]">
                  Remarks / Reason
                </p>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)]">
                  Why are you submitting this offline report?
                </p>
              </div>
            </div>

            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Site visit with poor or no internet connection. Client meeting at a remote location."
              rows={4}
              required
              className="w-full rounded-[var(--r-btn)] border px-4 py-3 text-[13.5px] font-semibold outline-none transition-colors resize-none"
              style={{
                borderColor: "var(--border-strong)",
                background: "var(--card)",
                color: "var(--text)",
              }}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[56px] rounded-[20px] text-white font-extrabold text-[15px] flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--mint-btn)", boxShadow: "var(--sh-btn)" }}
          >
            {submitting ? (
              <>
                <Loader2 size={19} className="animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <Send size={18} />
                Submit GPS Report
              </>
            )}
          </button>

          <p
            className="text-[11.5px] font-semibold text-center leading-relaxed"
            style={{ color: "var(--text-muted)" }}
          >
            Your administrator reviews this report. Add a clear reason and at least one photo so it
            can be approved quickly.
          </p>
        </form>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <ProtectedPageWrapper>
      <UserProvider>
        <GPSReportPage />
      </UserProvider>
    </ProtectedPageWrapper>
  );
}
