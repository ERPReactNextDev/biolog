"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import Camera from "./camera";
import { enqueuePendingLog } from "@/lib/offline-store";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MapPin, ArrowLeft, CheckCircle2, Clock, LogIn, LogOut, FileText, AlertCircle } from "lucide-react";

const ManualLocationPicker = dynamic(() => import("./manual-location-picker"), { ssr: false });

interface FormData {
  ReferenceID: string;
  Email: string;
  Type: string;
  Status: string;
  PhotoURL: string;
  Remarks: string;
  TSM: string;
  _id?: string;
}

interface UserDetails {
  ReferenceID: string;
  Email: string;
  TSM: string;
  faceDescriptors?: number[][];
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
  const [locationAddress, setLocationAddress] = useState("Fetching location...");
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

  useEffect(() => {
    if (open) {
      if (formData.Type !== "On Field") onChangeAction("Type", "On Field");
      setCapturedImage(null);
      setLocationAddress("Fetching location...");
      setManualLat(null);
      setManualLng(null);
    }
  }, [open]);

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
        console.warn(`Geolocation error (${err.code}): ${err.message}`);
        
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
    return () => setCapturedImage(null);
  }, [open]);

  useEffect(() => {
    const fetchLastStatus = async () => {
      try {
        const res = await fetch(`/api/ModuleSales/Activity/LastStatus?referenceId=${userDetails.ReferenceID}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.Status) {
          setLastStatus(data.Status);
          setLastTime(new Date(data.date_created).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }));
        } else {
          setLastStatus(null);
          setLastTime(null);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchLastStatus();
  }, [userDetails.ReferenceID]);

  const handleCreate = async () => {
    if (!capturedImage) return toast.error("Please capture a photo first.");
    if (!locationAddress || locationAddress === "Fetching location...") return toast.error("Location not ready yet.");
    setLoading(true);
    
    const isOnline = navigator.onLine;

    try {
      if (!isOnline) {
        // Queue the log locally for later sync
        const payload = { 
          ...formData, 
          PhotoURL: capturedImage, // Save the base64 image in the queue
          Location: locationAddress, 
          Latitude: latitude, 
          Longitude: longitude,
          FaceData: faceData 
        };
        await enqueuePendingLog(payload);
        toast.success("Offline! Your attendance has been queued and will sync when you are back online.");
        onOpenChangeAction(false);
        setFormAction({ ReferenceID: userDetails.ReferenceID, Email: userDetails.Email, Type: "On Field", Status: "", PhotoURL: "", Remarks: "", TSM: "" });
        setCapturedImage(null);
      } else {
        // Online: upload and submit immediately
        const photoURL = await uploadToCloudinary(capturedImage);
        const payload = { 
          ...formData, 
          PhotoURL: photoURL, 
          Location: locationAddress, 
          Latitude: latitude, 
          Longitude: longitude,
          FaceData: faceData 
        };
        const response = await fetch("/api/ModuleSales/Activity/AddLog", { 
          method: "POST", 
          headers: { "Content-Type": "application/json" }, 
          body: JSON.stringify(payload) 
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Failed to create attendance");
        toast.success("Attendance recorded successfully!");
        fetchAccountAction();
        onOpenChangeAction(false);
        setFormAction({ ReferenceID: userDetails.ReferenceID, Email: userDetails.Email, Type: "On Field", Status: "", PhotoURL: "", Remarks: "", TSM: "" });
        setCapturedImage(null);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Error saving attendance.");
    }
    setLoading(false);
  };

  const isSubmitDisabled = loading || !formData.Status || !capturedImage || locationAddress === "Fetching location..." || locationAddress.includes("unavailable");

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="p-0 rounded-[28px] max-w-sm w-full mx-auto overflow-hidden border-0 shadow-2xl max-h-[92vh] flex flex-col">

        {/* ── Header ── */}
        <div className="bg-brand-primary px-6 pt-5 pb-6 flex-shrink-0">
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => onOpenChangeAction(false)}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
            >
              <ArrowLeft size={15} />
            </button>
            <div className="flex-1">
              <h2 className="text-white font-semibold text-base leading-tight">Create Attendance</h2>
              <p className="text-white/65 text-[11px] mt-0.5">Field log entry</p>
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
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto flex-1 bg-brand-bg">
          <div className="flex flex-col gap-4 p-5">

            {/* Current Status Banner */}
            {lastStatus && (
              <div className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${lastStatus === "Login" ? "bg-[#EEF7F2] border-green-200" : "bg-brand-light border-red-200"}`}>
                {lastStatus === "Login"
                  ? <CheckCircle2 size={18} className="text-[#1A7A4A] flex-shrink-0" />
                  : <AlertCircle size={18} className="text-brand-primary flex-shrink-0" />}
                <div>
                  <p className={`text-[12px] font-semibold ${lastStatus === "Login" ? "text-[#1A7A4A]" : "text-brand-primary"}`}>
                    Currently {lastStatus === "Login" ? "Logged In" : "Logged Out"}
                  </p>
                  {lastTime && <p className="text-[11px] text-gray-400 mt-0.5">Last activity: {lastStatus} at {lastTime}</p>}
                </div>
              </div>
            )}

            {/* Camera */}
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Photo Verification</p>
              <Camera 
                registeredDescriptors={userDetails.faceDescriptors}
                onCaptureAction={(img, face) => {
                  setCapturedImage(img);
                  setFaceData(face);
                }} 
              />
              {capturedImage && (
                <div className="mt-2 flex items-center gap-2 bg-[#EEF7F2] rounded-xl px-3 py-2">
                  <CheckCircle2 size={14} className="text-[#1A7A4A]" />
                  <span className="text-[12px] font-semibold text-[#1A7A4A]">Photo captured successfully</span>
                </div>
              )}
            </div>

            {/* Show form after capture */}
            {capturedImage && (
              <>
                {/* Attendance Status */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Attendance Status</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => onChangeAction("Status", "Login")}
                      disabled={lastStatus === "Login"}
                      className={`rounded-2xl border-[1.5px] p-4 flex flex-col items-center gap-2 transition-all ${
                        formData.Status === "Login"
                          ? "bg-[#EEF7F2] border-[#1A7A4A]"
                          : "bg-white border-gray-200 hover:border-gray-300"
                      } ${lastStatus === "Login" ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <LogIn size={20} className={formData.Status === "Login" ? "text-[#1A7A4A]" : "text-gray-400"} />
                      <span className={`text-[13px] font-semibold ${formData.Status === "Login" ? "text-[#1A7A4A]" : "text-gray-700"}`}>Login</span>
                      <span className="text-[10px] text-gray-400">Start of shift</span>
                    </button>
                    <button
                      onClick={() => onChangeAction("Status", "Logout")}
                      disabled={lastStatus === "Logout"}
                      className={`rounded-2xl border-[1.5px] p-4 flex flex-col items-center gap-2 transition-all ${
                        formData.Status === "Logout"
                          ? "bg-brand-light border-brand-primary"
                          : "bg-white border-gray-200 hover:border-gray-300"
                      } ${lastStatus === "Logout" ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <LogOut size={20} className={formData.Status === "Logout" ? "text-brand-primary" : "text-gray-400"} />
                      <span className={`text-[13px] font-semibold ${formData.Status === "Logout" ? "text-brand-primary" : "text-gray-700"}`}>Logout</span>
                      <span className="text-[10px] text-gray-400">End of shift</span>
                    </button>
                  </div>
                </div>

                {/* Remarks */}
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <FileText size={12} /> Remarks
                  </label>
                  <textarea
                    value={formData.Remarks}
                    onChange={(e) => onChangeAction("Remarks", e.target.value)}
                    placeholder="Add notes or remarks (optional)..."
                    rows={3}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-800 placeholder:text-gray-300 resize-none outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                  />
                </div>

                {/* Location */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Location</p>
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 flex gap-3 items-start">
                    <div className="w-9 h-9 rounded-xl bg-brand-light flex items-center justify-center flex-shrink-0">
                      <MapPin size={16} className="text-brand-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-brand-primary uppercase tracking-wider mb-1">Detected Location</p>
                      <p className="text-[12px] text-gray-500 leading-snug">{locationAddress}</p>
                      <button
                        onClick={() => setShowMap(!showMap)}
                        className="mt-2 text-[11px] font-semibold text-brand-primary hover:underline"
                      >
                        {showMap ? "Hide map" : "⚙ Set manually →"}
                      </button>
                    </div>
                  </div>
                  {showMap && (
                    <div className="mt-2 rounded-2xl overflow-hidden border border-gray-200">
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

                {/* Submit */}
                <button
                  onClick={handleCreate}
                  disabled={isSubmitDisabled}
                  className={`w-full rounded-2xl py-4 text-[15px] font-semibold flex items-center justify-center gap-2 transition-all ${
                    isSubmitDisabled
                      ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                      : "bg-brand-primary text-white hover:bg-brand-primary-hover active:scale-[0.98] shadow-lg shadow-brand-primary/20"
                  }`}
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      Submit Attendance
                    </>
                  )}
                </button>

                <p className="text-center text-[11px] text-gray-300 pb-2">
                  Submission will be recorded with timestamp & GPS location
                </p>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}