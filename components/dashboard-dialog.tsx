import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MapPin, Calendar, Clock, User, FileText, Building2, ArrowLeft, LogIn, LogOut, Navigation, Camera } from "lucide-react";

interface ActivityLog {
  ReferenceID: string;
  Type: string;
  Status: string;
  Location: string;
  PhotoURL?: string;
  date_created: string;
  Remarks: string;
  SiteVisitAccount: string | null;
  _id?: string;
}

interface UserInfo {
  Firstname: string;
  Lastname: string;
  profilePicture?: string;
}

interface ActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedEvent: ActivityLog | null;
  usersMap: Record<string, UserInfo>;
}

export default function ActivityDialog({ open, onOpenChange, selectedEvent, usersMap }: ActivityDialogProps) {
  const user = selectedEvent ? usersMap[selectedEvent.ReferenceID] : null;
  const fullName = user ? `${user.Firstname} ${user.Lastname}` : "Unknown User";
  const initials = user ? `${user.Firstname[0]}${user.Lastname[0]}` : "?";

  const isLogin = selectedEvent?.Status === "Login";
  const isLogout = selectedEvent?.Status === "Logout";

  const statusColor = isLogin ? "#1A7A4A" : isLogout ? "var(--brand-primary)" : "#888";
  const statusBg = isLogin ? "#EEF7F2" : isLogout ? "var(--brand-light)" : "#F5F5F5";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 rounded-[28px] max-w-sm w-full mx-auto overflow-hidden border-0 shadow-2xl">

        {/* Header */}
        <div className="bg-brand-primary px-6 pt-5 pb-8">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => onOpenChange(false)}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
            >
              <ArrowLeft size={15} />
            </button>
            <div>
              <h2 className="text-white font-semibold text-base">Event Details</h2>
              <p className="text-white/65 text-[11px]">Activity log entry</p>
            </div>
          </div>

          {/* User card floating */}
          <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3 flex items-center gap-3">
            {user?.profilePicture ? (
              <img src={user.profilePicture} alt={fullName} className="w-10 h-10 rounded-full object-cover border-2 border-white/40" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-white/30 flex items-center justify-center text-white font-semibold text-sm border-2 border-white/40">
                {initials}
              </div>
            )}
            <div>
              <p className="text-white font-semibold text-sm">{fullName}</p>
              <p className="text-white/65 text-[11px]">
                {selectedEvent?.Type || "Unknown type"}
              </p>
            </div>
            {selectedEvent && (
              <div
                className="ml-auto rounded-xl px-3 py-1.5 text-[11px] font-semibold"
                style={{ background: statusBg, color: statusColor }}
              >
                {isLogin ? <LogIn size={10} className="inline mr-1" /> : <LogOut size={10} className="inline mr-1" />}
                {selectedEvent.Status}
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="bg-brand-bg px-5 py-5 flex flex-col gap-3 -mt-4 rounded-t-[24px] relative z-10">

          {selectedEvent ? (
            <>
              {/* Site Visit Account */}
              {selectedEvent.SiteVisitAccount && (
                <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#FDF4E7] flex items-center justify-center flex-shrink-0">
                    <Building2 size={14} className="text-[#A0611A]" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Site Visit</p>
                    <p className="text-[13px] font-semibold text-gray-800">{selectedEvent.SiteVisitAccount}</p>
                  </div>
                </div>
              )}

              {/* Date & Time */}
              <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 grid grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-brand-light flex items-center justify-center flex-shrink-0">
                    <Calendar size={14} className="text-brand-primary" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Date</p>
                    <p className="text-[13px] font-semibold text-gray-800">
                      {new Date(selectedEvent.date_created).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#E6F1FB] flex items-center justify-center flex-shrink-0">
                    <Clock size={14} className="text-[#185FA5]" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Time</p>
                    <p className="text-[13px] font-semibold text-gray-800">
                      {new Date(selectedEvent.date_created).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })}
                    </p>
                  </div>
                </div>
              </div>

              {/* Location */}
              <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-brand-light flex items-center justify-center flex-shrink-0">
                  <Navigation size={14} className="text-brand-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Location</p>
                  <p className="text-[12px] text-gray-700 leading-snug">{selectedEvent.Location || "No location recorded"}</p>
                </div>
              </div>

              {/* Photo Verification */}
              {selectedEvent.PhotoURL && (
                <div className="bg-white rounded-2xl border border-gray-100 p-1 flex flex-col">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-50">
                    <Camera size={13} className="text-brand-primary" />
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Photo Verification</p>
                  </div>
                  <div className="relative aspect-[4/3] rounded-xl overflow-hidden mt-1">
                    <img 
                      src={selectedEvent.PhotoURL} 
                      alt="Attendance verification" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}

              {/* Remarks */}
              {selectedEvent.Remarks && (
                <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
                    <FileText size={14} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Remarks</p>
                    <p className="text-[13px] text-gray-700">{selectedEvent.Remarks}</p>
                  </div>
                </div>
              )}

              <button
                onClick={() => onOpenChange(false)}
                className="w-full mt-1 rounded-2xl py-3.5 bg-brand-primary text-white font-semibold text-[14px] hover:bg-brand-primary-hover transition-colors active:scale-[0.98]"
              >
                Close
              </button>
            </>
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">No event selected.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}