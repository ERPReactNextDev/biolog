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
} from "lucide-react";
import { format } from "date-fns";

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
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; address?: string } | null>(null);
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

  const getCurrentLocation = useCallback(() => {
    setGettingLocation(true);
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by this browser.");
      setGettingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        
        // Try to get address from coordinates
        let address = "";
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
          );
          if (res.ok) {
            const data = await res.json();
            address = data.display_name || "";
          }
        } catch {
          // Silent fail - we still have coordinates
        }

        setGpsLocation({ lat: latitude, lng: longitude, address });
        setGettingLocation(false);
        toast.success("Location captured successfully!");
      },
      (error) => {
        console.error("Geolocation error:", error);
        toast.error("Failed to get location. Please enable location services.");
        setGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
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
    
    // Prepare payload
    const payload = {
      ReferenceID: userDetails.ReferenceID,
      Email: userDetails.Email,
      TSM: userDetails.TSM,
      photos,
      loginDate,
      logoutDate,
      remarks,
      gpsLocation,
    };
    
    console.log("[GPS Report] Submitting payload:", {
      ReferenceID: payload.ReferenceID,
      Email: payload.Email,
      photosCount: payload.photos.length,
      loginDate: payload.loginDate,
      logoutDate: payload.logoutDate,
      gpsLocation: payload.gpsLocation,
    });
    
    try {
      const res = await fetch("/api/gps-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      console.log("[GPS Report] Response status:", res.status);
      
      if (res.ok) {
        const data = await res.json();
        console.log("[GPS Report] Success response:", data);
        toast.success("GPS Report submitted successfully!");
        // Reset form
        setPhotos([]);
        setLoginDate("");
        setLogoutDate("");
        setRemarks("");
        setGpsLocation(null);
        // Navigate back to activity planner
        setTimeout(() => {
          router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
        }, 1500);
      } else {
        const errorData = await res.json();
        console.error("[GPS Report] Error response:", errorData);
        toast.error(errorData.error || `Failed to submit report (${res.status}).`);
      }
    } catch (err) {
      console.error("[GPS Report] Submit error:", err);
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const goBack = () => {
    router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9F6F4] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-[#CC1318] rounded-full animate-spin" />
          <p className="text-[12px] text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9F6F4] flex flex-col">
      {/* Header */}
      <div
        className="px-5 pt-12 pb-6 flex-shrink-0"
        style={{
          background:
            "linear-gradient(145deg, var(--brand-primary) 0%, var(--brand-primary-hover) 100%)",
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={goBack}
            className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-white text-[20px] font-semibold">
              Submit GPS Report
            </h1>
            <p className="text-white/60 text-[12px]">
              Offline attendance verification
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-28">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* User Info Card */}
          {userDetails && (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[14px] bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0">
                  <FileText size={18} className="text-[var(--brand-primary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-800">
                    {userDetails.Firstname} {userDetails.Lastname}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {userDetails.Role} · {userDetails.ReferenceID}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Photo Upload */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-[14px] bg-[#E6F1FB] flex items-center justify-center flex-shrink-0">
                <Camera size={18} className="text-[#185FA5]" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-800">
                  Site Photos
                </p>
                <p className="text-[11px] text-gray-400">
                  Upload photos as proof (max 5)
                </p>
              </div>
            </div>

            {/* Photo Preview Grid */}
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                {photos.map((photo, index) => (
                  <div key={index} className="relative aspect-square">
                    <img
                      src={photo}
                      alt={`Site photo ${index + 1}`}
                      className="w-full h-full object-cover rounded-xl"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(index)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#CC1318] text-white flex items-center justify-center text-[10px]"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload Button */}
            {photos.length < 5 && (
              <label className="flex items-center justify-center gap-2 w-full py-4 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50 cursor-pointer hover:border-[var(--brand-primary)]/30 hover:bg-[var(--brand-light)]/20 transition-all">
                <Upload size={18} className="text-gray-400" />
                <span className="text-[13px] font-medium text-gray-500">
                  Add Photos
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

          {/* Date Selection */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-[14px] bg-[#EEF7F2] flex items-center justify-center flex-shrink-0">
                <Calendar size={18} className="text-[#1A7A4A]" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-800">
                  Time Period
                </p>
                <p className="text-[11px] text-gray-400">
                  When did you visit the site?
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider ml-1">
                  Login Date
                </label>
                <div className="relative">
                  <Clock
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="datetime-local"
                    required
                    value={loginDate}
                    onChange={(e) => setLoginDate(e.target.value)}
                    className="w-full rounded-xl border border-gray-100 bg-gray-50 pl-9 pr-3 py-2.5 text-[12px] outline-none focus:border-[var(--brand-primary)] transition-all"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider ml-1">
                  Logout Date
                </label>
                <div className="relative">
                  <Clock
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="datetime-local"
                    required
                    value={logoutDate}
                    onChange={(e) => setLogoutDate(e.target.value)}
                    className="w-full rounded-xl border border-gray-100 bg-gray-50 pl-9 pr-3 py-2.5 text-[12px] outline-none focus:border-[var(--brand-primary)] transition-all"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* GPS Location */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-[14px] bg-[#FDF4E7] flex items-center justify-center flex-shrink-0">
                <MapPin size={18} className="text-[#A0611A]" />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-semibold text-gray-800">
                  GPS Location
                </p>
                <p className="text-[11px] text-gray-400">
                  {gpsLocation
                    ? "Location captured"
                    : "Capture your current location"}
                </p>
              </div>
            </div>

            {gpsLocation ? (
              <div className="bg-[#EEF7F2] rounded-xl p-3 border border-green-100">
                <p className="text-[12px] font-medium text-[#1A7A4A]">
                  ✓ Location Captured
                </p>
                <p className="text-[11px] text-gray-600 mt-1">
                  Lat: {gpsLocation.lat.toFixed(6)}, Lng: {gpsLocation.lng.toFixed(6)}
                </p>
                {gpsLocation.address && (
                  <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">
                    {gpsLocation.address}
                  </p>
                )}
                <button
                  type="button"
                  onClick={getCurrentLocation}
                  className="mt-2 text-[11px] font-medium text-[#1A7A4A] underline"
                >
                  Update Location
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={getCurrentLocation}
                disabled={gettingLocation}
                className="w-full py-3 rounded-xl bg-[var(--brand-primary)] text-white font-semibold text-[13px] flex items-center justify-center gap-2 hover:bg-[var(--brand-primary-hover)] transition-all disabled:opacity-50"
              >
                {gettingLocation ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Getting Location...
                  </>
                ) : (
                  <>
                    <MapPin size={16} />
                    Capture GPS Location
                  </>
                )}
              </button>
            )}
          </div>

          {/* Remarks */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-[14px] bg-gray-50 flex items-center justify-center flex-shrink-0">
                <FileText size={18} className="text-gray-500" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-800">
                  Remarks / Reason
                </p>
                <p className="text-[11px] text-gray-400">
                  Why are you submitting this offline report?
                </p>
              </div>
            </div>

            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g., Site visit with poor/no internet connection. Client meeting at remote location."
              rows={4}
              required
              className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-[13px] outline-none focus:border-[var(--brand-primary)] transition-all resize-none"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 rounded-2xl bg-[var(--brand-primary)] text-white font-bold text-[14px] flex items-center justify-center gap-2 hover:bg-[var(--brand-primary-hover)] active:scale-[0.98] transition-all disabled:opacity-50 shadow-lg shadow-red-100"
          >
            {submitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send size={18} />
                Submit GPS Report
              </>
            )}
          </button>

          <p className="text-[11px] text-gray-400 text-center">
            This report will be reviewed by your administrator.
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
