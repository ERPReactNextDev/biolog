"use client";

import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import ProtectedPageWrapper from "@/components/protected-page-wrapper";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { toast } from "sonner";
import { type DateRange } from "react-day-picker";
import { MapPin, X, CalendarCheck, ChevronLeft, ChevronRight, Building2, Home, BarChart3, User, LogIn, LogOut, TrendingUp, Plus, FileSpreadsheet, CalendarIcon, Clock, Megaphone, ChevronRight as ArrowRight, Power, Cloud, Sun, CloudRain, CloudLightning, Info, Fingerprint, Smartphone, Laptop, Globe, ShieldCheck, Trash2, Settings, Users, ShieldAlert, Download } from "lucide-react";

import { useOfflineSync } from "@/hooks/useOfflineSync";
import OfflineBanner from "@/components/OfflineBanner";
import { useNotifications } from "@/hooks/useNotifications";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import { useSwipeToRefresh } from "@/hooks/useSwipeToRefresh";
import { haptic } from "@/lib/haptics";
import { usePreferences } from "@/lib/preferences";
import { playNotificationSound } from "@/lib/notification-sound";

// ── Lazy-load heavy dialog components — only parsed/bundled when first opened ─
const ActivityDialog        = dynamic(() => import("@/components/dashboard-dialog"),    { ssr: false });
const CreateAttendance      = dynamic(() => import("@/components/CreateAttendance"),     { ssr: false });
const CreateSalesAttendance = dynamic(() => import("@/components/CreateSalesAttenance"), { ssr: false });
const CameraLazy            = dynamic(() => import("@/components/camera"),              { ssr: false });


// ── Weather Component ────────────────────────────────────────────────────────

const WEATHER_CACHE_KEY = "acculog_weather";
const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function WeatherDisplay() {
  const [weather, setWeather] = useState<{ temp: number; icon: string } | null>(null);

  useEffect(() => {
    // Check sessionStorage cache first — avoids re-fetching on every tab switch
    try {
      const cached = sessionStorage.getItem(WEATHER_CACHE_KEY);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < WEATHER_CACHE_TTL) {
          setWeather(data);
          return;
        }
      }
    } catch { /* ignore */ }

    const fetchWeather = async (lat: number, lon: number) => {
      try {
        const API_KEY = "bd5e378503939ddaee76f12ad7a97608";
        const res = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`
        );
        const data = await res.json();
        if (data.main) {
          const w = { temp: Math.round(data.main.temp), icon: data.weather[0].icon };
          setWeather(w);
          try { sessionStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ data: w, ts: Date.now() })); } catch { /* quota */ }
        }
      } catch { /* non-critical */ }
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
      () => { /* silent */ },
      { timeout: 8000, maximumAge: 600000 } // use cached GPS up to 10 min old
    );
  }, []);

  if (!weather) return null;

  const WeatherIcon = () => {
    const code = weather.icon;
    if (code.includes("01")) return <Sun size={14} className="text-yellow-400" />;
    if (code.includes("02") || code.includes("03") || code.includes("04")) return <Cloud size={14} className="text-gray-400" />;
    if (code.includes("09") || code.includes("10")) return <CloudRain size={14} className="text-blue-400" />;
    if (code.includes("11")) return <CloudLightning size={14} className="text-purple-400" />;
    return <Cloud size={14} className="text-gray-400" />;
  };


  return (
    <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md rounded-full px-2.5 py-1 border border-white/10 shadow-sm">
      <WeatherIcon />
      <span className="text-[11px] font-bold text-white">{weather.temp}°C</span>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

type ActiveTab = "home" | "calendar" | "reports" | "profile" | "admin";

type TimelineItem = {
  id: string;
  title?: string | null;
  description: string;
  location: string;
  status: string;
  date?: string;
};

interface ActivityLog {
  ReferenceID: string;
  Email: string;
  Type: string;
  Status: string;
  Location: string;
  date_created: string;
  PhotoURL?: string;
  Remarks: string;
  TSM: string;
  SiteVisitAccount: string;
  _id?: string;
}

interface Meeting {
  _id?: string;
  ReferenceID: string;
  Email: string;
  Title: string;
  StartDate: string;
  EndDate: string;
  Duration: number;
  Location: string;
  Remarks: string;
  TSM: string;
  Status: string;
  CreatedAt: string;
}

interface UserInfo {
  Firstname: string;
  Lastname: string;
  profilePicture?: string;
  faceDescriptors?: number[][];
  TSM: string;
  Directories: string[];
}

interface UserDetails {
  UserId: string;
  Firstname: string;
  Lastname: string;
  Email: string;
  Role: string;
  Department: string;
  Company?: string;
  ReferenceID: string;
  profilePicture?: string;
  faceDescriptors?: number[][];
  credentials?: any[];
  twoFactorEnabled?: boolean;
  SecondaryEmail?: string;
  pin?: string;
  TSM: string;
  Directories?: string[];
  permissions?: {
    canCreateAttendance: boolean;
    canCreateSiteVisit: boolean;
  };
  faceVerificationEnabled?: boolean;
}

interface FormData {
  ReferenceID: string;
  Email: string;
  Type: string;
  Status: string;
  PhotoURL: string;
  Remarks: string;
  TSM: string;
  SitePhotoURL?: string;
  SiteVisitAccount?: string;
  _id?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLocalDateKey(date: Date | string, startHour: number = 8) {
  const d = typeof date === "string" ? new Date(date) : date;
  // If before work day start, it belongs to the previous work day
  if (d.getHours() < startHour) {
    d.setDate(d.getDate() - 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function generateCalendarDays(year: number, month: number): Date[] {
  const days: Date[] = [];
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const firstWeekday = firstDayOfMonth.getDay();
  for (let i = firstWeekday - 1; i >= 0; i--) days.push(new Date(year, month, 1 - i - 1));
  for (let day = 1; day <= lastDayOfMonth.getDate(); day++) days.push(new Date(year, month, day));
  while (days.length % 7 !== 0) {
    days.push(new Date(year, month, lastDayOfMonth.getDate() + (days.length - firstWeekday) + 1));
  }
  return days;
}

function isSameDay(d1: Date, d2: Date) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// ── Live Clock ────────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{time}</span>;
}

// ── Timeline Item ─────────────────────────────────────────────────────────────

function TimelineItemComponent({ item, index }: { item: TimelineItem; index: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const isLogin = item.status === "Login";
  const isMeeting = item.status === "Meeting";
  const iconColor = isLogin ? "#1A7A4A" : isMeeting ? "#9333EA" : "var(--brand-primary)";
  const bgColor = isLogin ? "#EEF7F2" : isMeeting ? "#F5F3FF" : "var(--brand-light)";

  return (
    <div ref={ref} className="relative flex gap-3">
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={inView ? { scale: 1, opacity: 1 } : undefined}
        transition={{ delay: index * 0.12, duration: 0.25 }}
        className="flex-shrink-0 flex flex-col items-center"
      >
        <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: bgColor }}>
          {isLogin ? <LogIn size={12} style={{ color: iconColor }} /> :
            item.status === "Logout" ? <LogOut size={12} style={{ color: iconColor }} /> :
              isMeeting ? <Users size={12} style={{ color: iconColor }} /> :
                <Building2 size={12} style={{ color: "#A0611A" }} />}
        </div>
        <div className="w-px flex-1 mt-1 min-h-[12px]" style={{ background: "#EDE5E1" }} />
      </motion.div>
      <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={inView ? { opacity: 1, x: 0 } : undefined}
        transition={{ delay: index * 0.12 + 0.15, type: "spring", stiffness: 300, damping: 25 }}
        className="flex-1 bg-white rounded-2xl border border-gray-100 px-3 py-2.5 mb-2.5"
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: iconColor }}>
            {item.status}
          </span>
          <span className="text-[10px] text-gray-400 font-medium">
            {item.date}
          </span>
        </div>
        {item.title && item.title.trim() !== "" && item.title !== "Unknown Client" && (
          <p className="mt-0.5 text-[12px] font-semibold text-gray-800">
            {item.status === "Login" || item.status === "Logout" ? item.status : `Visited: ${item.title}`}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-gray-500 leading-snug">{item.location}</p>
        {item.description && item.description !== "No remarks" && (
          <p className="mt-0.5 text-[10px] text-gray-400 italic">"{item.description}"</p>
        )}
      </motion.div>
    </div>
  );
}

// ── Timesheet Nav Card ────────────────────────────────────────────────────────

function TimesheetNavCard({ userId }: { userId: string | null | undefined }) {
  const router = useRouter();
  const href = `/time-attendance/timesheet${userId ? `?id=${encodeURIComponent(userId)}` : ""}`;
  return (
    <button
      onClick={() => router.push(href)}
      className="w-full flex items-center gap-4 bg-white rounded-2xl border border-gray-100 px-4 py-4 text-left hover:border-[var(--brand-primary)]/30 hover:bg-[var(--brand-light)] active:scale-[0.98] transition-all group shadow-sm"
    >
      <div className="w-11 h-11 rounded-[14px] bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--brand-primary)] transition-colors">
        <FileSpreadsheet size={20} className="text-[var(--brand-primary)] group-hover:text-white transition-colors" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-gray-800">Timesheet</p>
        <p className="text-[11px] text-gray-400 mt-0.5">View hours, late, undertime & overtime</p>
      </div>
      <div className="w-7 h-7 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--brand-primary)] transition-colors">
        <ArrowRight size={13} className="text-gray-400 group-hover:text-white transition-colors" />
      </div>
    </button>
  );
}

// ── Home Tab ──────────────────────────────────────────────────────────────────

function HomeTab({
  userDetails, todayLogs, monthlyStats, onCreateAttendance, onCreateSiteVisit, onSetTab, userId, scrollRef,
}: {
  userDetails: UserDetails | null;
  todayLogs: ActivityLog[];
  monthlyStats: { present: number; absent: number; visits: number; total: number };
  onCreateAttendance: () => void;
  onCreateSiteVisit: () => void;
  onSetTab: (tab: ActiveTab) => void;
  userId: string | null | undefined;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const router = useRouter();
  const today = new Date();
  const greeting = today.getHours() < 12 ? "Good morning" : today.getHours() < 17 ? "Good afternoon" : "Good evening";
  const presentRate = monthlyStats.total > 0 ? Math.round((monthlyStats.present / monthlyStats.total) * 100) : 0;
  const initials = userDetails ? `${userDetails.Firstname[0] ?? ""}${userDetails.Lastname[0] ?? ""}`.toUpperCase() : "?";

  const [systemSettings, setSystemSettings] = useState({
    officeStartTime: "08:00",
    officeEndTime: "17:00",
    gracePeriod: 15,
    themeColor: "red",
    logoUrl: "",
    announcement: ""
  });

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then(data => {
        if (data && data.type === "global") {
          setSystemSettings({
            officeStartTime: data.officeStartTime || "08:00",
            officeEndTime: data.officeEndTime || "17:00",
            gracePeriod: data.gracePeriod || 15,
            themeColor: data.themeColor || "red",
            logoUrl: data.logoUrl || "",
            announcement: data.announcement || ""
          });
          if (data.themeColor) {
            document.documentElement.setAttribute("data-theme", data.themeColor);
          }
        }
      })
      .catch(() => { /* silent */ });
  }, []);

  // Check if user is late
  const firstLogin = [...todayLogs].reverse().find(l => l.Status === "Login");
  let isLate = false;
  if (firstLogin) {
    const loginTime = new Date(firstLogin.date_created);
    const [sH, sM] = systemSettings.officeStartTime.split(":").map(Number);
    const shiftStart = new Date(loginTime);
    shiftStart.setHours(sH, sM, 0, 0);
    const graceThreshold = new Date(shiftStart);
    graceThreshold.setMinutes(shiftStart.getMinutes() + systemSettings.gracePeriod);
    isLate = loginTime > graceThreshold;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="relative px-5 pt-12 pb-8 overflow-hidden flex-shrink-0" style={{ background: "linear-gradient(145deg,var(--brand-primary) 0%,var(--brand-primary-hover) 100%)" }}>
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-16 -left-6 w-52 h-52 rounded-full bg-white/[0.03] pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/20 overflow-hidden">
                {systemSettings.logoUrl ? (
                  <img src={systemSettings.logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <rect x="2" y="8" width="14" height="2" rx="1" fill="white" />
                    <rect x="2" y="4" width="9" height="2" rx="1" fill="white" />
                    <rect x="2" y="12" width="11" height="2" rx="1" fill="white" />
                  </svg>
                )}
              </div>
              <span className="text-white text-[14px] font-black tracking-[0.1em]">BIOLOG</span>
            </div>
            <div className="flex items-center gap-3">
              <WeatherDisplay />
              {userDetails?.profilePicture ? (
                <img src={userDetails.profilePicture} alt="" className="w-9 h-9 rounded-full border-2 border-white/30 object-cover shadow-sm" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-white/20 border border-white/30 flex items-center justify-center text-white text-sm font-bold backdrop-blur-sm">{initials}</div>
              )}
            </div>
          </div>
          <p className="text-white/70 text-xs mb-1">{greeting} 👋</p>
          <h1 className="text-white uppercase text-xl font-semibold mb-0.5">{userDetails ? `${userDetails.Firstname} ${userDetails.Lastname}` : "Loading..."}</h1>
          <p className="text-white/60 text-[12px] uppercase">{userDetails?.Role ?? "—"} · {userDetails?.Department ?? "—"}</p>
        </div>
      </div>

      <div className="mx-4 -mt-5 relative z-20 flex-shrink-0">
        <div className="bg-white rounded-[22px] shadow-lg shadow-gray-200/80 border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Current Status</span>
            <span className="flex items-center gap-1.5 bg-[#EEF7F2] rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1A7A4A] animate-pulse" />
              <span className="text-[11px] font-semibold text-[#1A7A4A]">Active</span>
            </span>
          </div>
          <div className="flex items-end justify-between">
            <div className="flex flex-col">
              <div className="text-[32px] font-bold text-gray-900 tracking-tighter leading-none tabular-nums flex items-center gap-2">
                <LiveClock />
              </div>
              <p className="text-[11px] font-medium text-gray-400 mt-1 flex items-center gap-1.5">
                <CalendarIcon size={12} />
                {today.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </p>
            </div>
            <div className="h-12 w-px bg-gray-100" />
            <div className="text-right">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Work Shift</p>
              <div className="flex items-center gap-1.5 justify-end">
                <Clock size={14} className="text-[var(--brand-primary)]" />
                <p className="text-[15px] font-bold text-gray-800">{systemSettings.officeStartTime} – {systemSettings.officeEndTime}</p>
              </div>
              <span className={`inline-flex items-center gap-1.5 mt-2 ${isLate ? "bg-[var(--brand-light)] border-red-100" : "bg-[#EEF7F2] border-green-100"} border rounded-full px-2.5 py-1`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isLate ? "bg-[var(--brand-primary)]" : "bg-[#1A7A4A]"} animate-pulse`} />
                <span className={`text-[10px] font-bold ${isLate ? "text-[var(--brand-primary)]" : "text-[#1A7A4A]"} uppercase tracking-wider`}>
                  {isLate ? "Late" : (firstLogin ? "On Schedule" : "Not In")}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-28 scroll-smooth" ref={scrollRef}>
        {/* Global Announcement */}
        {systemSettings.announcement && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 bg-purple-50 border border-purple-100 rounded-[22px] p-4 flex gap-4"
          >
            <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-purple-600 flex-shrink-0 shadow-sm">
              <Megaphone size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1">Admin Announcement</p>
              <p className="text-[13px] text-purple-900 font-medium leading-relaxed">{systemSettings.announcement}</p>
            </div>
          </motion.div>
        )}

        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Quick Actions</p>
        <div className="grid grid-cols-2 gap-3 mb-5">
          {(userDetails?.Role === "Admin" || userDetails?.Role === "SuperAdmin") && (
            <>
              <button onClick={() => router.push(`/admin/attendance-summary${userId ? `?id=${encodeURIComponent(userId)}` : ""}`)} className="bg-white rounded-[18px] p-4 text-left border border-gray-100 hover:border-gray-200 hover:bg-gray-50 active:scale-[0.97] transition-all">
                <div className="w-9 h-9 rounded-[10px] bg-[#EEF7F2] flex items-center justify-center mb-3 border border-gray-100"><FileSpreadsheet size={18} className="text-[#1A7A4A]" /></div>
                <p className="text-gray-800 text-[13px] font-semibold">Reports Summary</p>
                <p className="text-gray-400 text-[11px] mt-0.5">Payroll export</p>
              </button>
              <button onClick={() => router.push(`/admin/tickets${userId ? `?id=${encodeURIComponent(userId)}` : ""}`)} className="bg-white rounded-[18px] p-4 text-left border border-gray-100 hover:border-gray-200 hover:bg-gray-50 active:scale-[0.97] transition-all">
                <div className="w-9 h-9 rounded-[10px] bg-[#E6F1FB] flex items-center justify-center mb-3 border border-gray-100"><ShieldAlert size={18} className="text-[#185FA5]" /></div>
                <p className="text-gray-800 text-[13px] font-semibold">Concerns</p>
                <p className="text-gray-400 text-[11px] mt-0.5">Manage tickets</p>
              </button>
              <button onClick={() => router.push(`/admin/live-tracking${userId ? `?id=${encodeURIComponent(userId)}` : ""}`)} className="bg-white rounded-[18px] p-4 text-left border border-gray-100 hover:border-gray-200 hover:bg-gray-50 active:scale-[0.97] transition-all">
                <div className="w-9 h-9 rounded-[10px] bg-[#FDF4E7] flex items-center justify-center mb-3 border border-gray-100"><MapPin size={18} className="text-[#A0611A]" /></div>
                <p className="text-gray-800 text-[13px] font-semibold">Live Tracking</p>
                <p className="text-gray-400 text-[11px] mt-0.5">Monitor field</p>
              </button>
            </>
          )}
          {(userDetails?.Role !== "SuperAdmin") ? (
            <>
              {userDetails?.permissions?.canCreateAttendance && (
                <button onClick={onCreateAttendance} className="bg-[var(--brand-primary)] rounded-[18px] p-4 text-left hover:bg-[var(--brand-primary-hover)] active:scale-[0.97] transition-all shadow-md shadow-red-100">
                  <div className="w-9 h-9 rounded-[10px] bg-white/20 flex items-center justify-center mb-3"><CalendarCheck size={18} className="text-white" /></div>
                  <p className="text-white text-[13px] font-semibold">Time In/Out</p>
                  <p className="text-white/65 text-[11px] mt-0.5">Log field attendance</p>
                </button>
              )}
              {userDetails?.permissions?.canCreateSiteVisit && (
                <button onClick={onCreateSiteVisit} className="bg-white rounded-[18px] p-4 text-left border border-gray-100 hover:border-gray-200 hover:bg-gray-50 active:scale-[0.97] transition-all">
                  <div className="w-9 h-9 rounded-[10px] bg-[var(--brand-light)] flex items-center justify-center mb-3 border border-gray-100"><Building2 size={18} className="text-[var(--brand-primary)]" /></div>
                  <p className="text-gray-800 text-[13px] font-semibold">Site Visit</p>
                  <p className="text-gray-400 text-[11px] mt-0.5">Record client visit</p>
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={onCreateAttendance} className="bg-[var(--brand-primary)] rounded-[18px] p-4 text-left hover:bg-[var(--brand-primary-hover)] active:scale-[0.97] transition-all shadow-md shadow-red-200">
                <div className="w-9 h-9 rounded-[10px] bg-white/20 flex items-center justify-center mb-3"><CalendarCheck size={18} className="text-white" /></div>
                <p className="text-white text-[13px] font-semibold">Time In/Out</p>
                <p className="text-white/65 text-[11px] mt-0.5">Log field attendance</p>
              </button>
              <button onClick={onCreateSiteVisit} className="bg-white rounded-[18px] p-4 text-left border border-gray-100 hover:border-gray-200 hover:bg-gray-50 active:scale-[0.97] transition-all">
                <div className="w-9 h-9 rounded-[10px] bg-[var(--brand-light)] flex items-center justify-center mb-3 border border-gray-100"><Building2 size={18} className="text-[var(--brand-primary)]" /></div>
                <p className="text-gray-800 text-[13px] font-semibold">Site Visit</p>
                <p className="text-gray-400 text-[11px] mt-0.5">Record client visit</p>
              </button>
            </>
          )}
          <button onClick={() => onSetTab("calendar")} className="bg-white rounded-[18px] p-4 text-left border border-gray-100 hover:border-gray-200 hover:bg-gray-50 active:scale-[0.97] transition-all">
            <div className="w-9 h-9 rounded-[10px] bg-gray-50 flex items-center justify-center mb-3 border border-gray-100"><CalendarCheck size={18} className="text-gray-500" /></div>
            <p className="text-gray-800 text-[13px] font-semibold">Calendar</p>
            <p className="text-gray-400 text-[11px] mt-0.5">View monthly logs</p>
          </button>
          <button onClick={() => onSetTab("reports")} className="bg-white rounded-[18px] p-4 text-left border border-gray-100 hover:border-gray-200 hover:bg-gray-50 active:scale-[0.97] transition-all">
            <div className="w-9 h-9 rounded-[10px] bg-gray-50 flex items-center justify-center mb-3 border border-gray-100"><BarChart3 size={18} className="text-gray-500" /></div>
            <p className="text-gray-800 text-[13px] font-semibold">Reports</p>
            <p className="text-gray-400 text-[11px] mt-0.5">Attendance summary</p>
          </button>
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-gray-500">Monthly Attendance</p>
            <p className="text-[11px] font-bold text-gray-800">{monthlyStats.present} / {monthlyStats.total} days</p>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${presentRate}%`, background: "linear-gradient(90deg,var(--brand-primary),var(--brand-primary-hover))" }} />
          </div>
          <p className="text-[10px] text-gray-400 mt-1">{presentRate}% attendance rate this month</p>
        </div>

        {/*<div className="border-t border-gray-100 pt-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Today's Log</p>
          {todayLogs.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 px-4 py-6 text-center">
              <p className="text-[12px] text-gray-400">No activity recorded today.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0">
              {todayLogs.map((log) => {
                const isLogin = log.Status === "Login";
                return (
                  <div key={log._id ?? log.date_created} className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
                    <div className={`w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0 ${isLogin ? "bg-[#EEF7F2]" : log.Type === "Client Visit" ? "bg-[#FDF4E7]" : "bg-[#FEF0F0]"}`}>
                      {isLogin ? <LogIn size={15} className="text-[#1A7A4A]" /> : log.Type === "Client Visit" ? <Building2 size={15} className="text-[#A0611A]" /> : <LogOut size={15} className="text-[#CC1318]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-gray-800 truncate">{log.Status} – {log.Type}</p>
                      <p className="text-[11px] text-gray-400 truncate mt-0.5">{log.Location || "—"}</p>
                    </div>
                    <p className="text-[11px] font-semibold text-gray-500 flex-shrink-0">
                      {new Date(log.date_created).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>*/}
      </div>
    </div>
  );
}

// ── Calendar Tab ──────────────────────────────────────────────────────────────

// Lightweight metadata for calendar dots (no full details)
interface DateMeta {
  dateKey: string;
  hasLogin: boolean;
  hasLogout: boolean;
  hasMeeting: boolean;
}

function CalendarTab({ currentMonth, calendarDays, usersMap, onEventClick, onMeetingClick, onCreateMeeting, goToPrevMonth, goToNextMonth, startHour, userDetails }: {
  currentMonth: Date; calendarDays: Date[];
  usersMap: Record<string, UserInfo>;
  onEventClick: (log: ActivityLog) => void;
  onMeetingClick: (meeting: Meeting) => void;
  onCreateMeeting: () => void;
  goToPrevMonth: () => void; goToNextMonth: () => void;
  startHour: number;
  userDetails: UserDetails | null;
}) {
  const today = new Date();
  const DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];
  const [activeFilter, setActiveFilter] = useState<"All" | "Login" | "Logout" | "Site Visit" | "Meeting">("All");
  const [selectedDate, setSelectedDate] = useState<string>(toLocalDateKey(today, startHour));
  
  // Data states - fetched on demand
  const [selectedDateLogs, setSelectedDateLogs] = useState<ActivityLog[]>([]);
  const [selectedDateMeetings, setSelectedDateMeetings] = useState<Meeting[]>([]);
  const [monthlyMeta, setMonthlyMeta] = useState<DateMeta[]>([]);
  const [monthlyStats, setMonthlyStats] = useState({ present: 0, absent: 0, visits: 0, total: 0 });
  const [loadingDate, setLoadingDate] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);

  // Fetch monthly metadata (lightweight - for dots and stats only)
  const fetchMonthlyMeta = useCallback(async () => {
    if (!userDetails) return;
    setLoadingMeta(true);
    try {
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
      
      const params = new URLSearchParams();
      params.append("page", "1");
      params.append("limit", "1000"); // Get all for the month
      params.append("role", userDetails.Role);
      if (userDetails.Role !== "SuperAdmin" && userDetails.Role !== "Human Resources") {
        params.append("referenceID", userDetails.ReferenceID);
      }
      params.append("startDate", startOfMonth.toISOString());
      params.append("endDate", endOfMonth.toISOString());
      params.append("metaOnly", "true"); // Request lightweight metadata

      // Fetch logs metadata
      const logsRes = await fetch(`/api/ModuleSales/Activity/FetchLog?${params.toString()}`);
      const logsData = logsRes.ok ? await logsRes.json() : { data: [] };
      
      // Fetch meetings for the month
      const meetingParams = new URLSearchParams();
      meetingParams.append("role", userDetails.Role);
      if (userDetails.Role !== "SuperAdmin" && userDetails.Role !== "Human Resources") {
        meetingParams.append("referenceID", userDetails.ReferenceID);
      }
      meetingParams.append("startDate", startOfMonth.toISOString());
      meetingParams.append("endDate", endOfMonth.toISOString());
      const meetingsRes = await fetch(`/api/ModuleSales/Activity/Meeting?${meetingParams.toString()}`);
      const meetingsData = meetingsRes.ok ? await meetingsRes.json() : [];

      // Build metadata map
      const metaMap = new Map<string, DateMeta>();
      
      // Process logs
      (logsData.data || []).forEach((log: ActivityLog) => {
        const key = toLocalDateKey(log.date_created, startHour);
        const existing = metaMap.get(key) || { dateKey: key, hasLogin: false, hasLogout: false, hasMeeting: false };
        if (log.Status === "Login") existing.hasLogin = true;
        if (log.Status === "Logout") existing.hasLogout = true;
        metaMap.set(key, existing);
      });
      
      // Process meetings
      (meetingsData || []).forEach((meeting: Meeting) => {
        const key = toLocalDateKey(meeting.StartDate, startHour);
        const existing = metaMap.get(key) || { dateKey: key, hasLogin: false, hasLogout: false, hasMeeting: false };
        existing.hasMeeting = true;
        metaMap.set(key, existing);
      });
      
      setMonthlyMeta(Array.from(metaMap.values()));
      
      // Calculate monthly stats
      const loginDays = new Set((logsData.data || []).filter((l: ActivityLog) => l.Status === "Login").map((l: ActivityLog) => toLocalDateKey(l.date_created)));
      const visits = (logsData.data || []).filter((l: ActivityLog) => l.Type === "Client Visit").length;
      const workDays = calendarDays.filter((d) => d.getMonth() === currentMonth.getMonth() && d.getDay() !== 0 && d.getDay() !== 6).length;
      const present = loginDays.size;
      setMonthlyStats({ present, absent: Math.max(0, workDays - present), visits, total: workDays });
    } catch {
      // silent
    } finally {
      setLoadingMeta(false);
    }
  }, [currentMonth, userDetails, startHour, calendarDays]);

  // Fetch details for selected date only
  const fetchDateDetails = useCallback(async (dateKey: string) => {
    if (!userDetails) return;
    setLoadingDate(true);
    try {
      const date = new Date(dateKey);
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      
      const params = new URLSearchParams();
      params.append("page", "1");
      params.append("limit", "100");
      params.append("role", userDetails.Role);
      if (userDetails.Role !== "SuperAdmin" && userDetails.Role !== "Human Resources") {
        params.append("referenceID", userDetails.ReferenceID);
      }
      params.append("startDate", date.toISOString());
      params.append("endDate", nextDay.toISOString());

      // Fetch logs for date
      const logsRes = await fetch(`/api/ModuleSales/Activity/FetchLog?${params.toString()}`);
      const logsData = logsRes.ok ? await logsRes.json() : { data: [] };
      
      // Filter to exact date (API returns range)
      const dateLogs = (logsData.data || []).filter((log: ActivityLog) => 
        toLocalDateKey(log.date_created, startHour) === dateKey
      );
      setSelectedDateLogs(dateLogs);
      
      // Fetch meetings for date
      const meetingParams = new URLSearchParams();
      meetingParams.append("role", userDetails.Role);
      if (userDetails.Role !== "SuperAdmin" && userDetails.Role !== "Human Resources") {
        meetingParams.append("referenceID", userDetails.ReferenceID);
      }
      const meetingsRes = await fetch(`/api/ModuleSales/Activity/Meeting?${meetingParams.toString()}`);
      const allMeetings = meetingsRes.ok ? await meetingsRes.json() : [];
      
      // Filter meetings to selected date
      const dateMeetings = (allMeetings || []).filter((m: Meeting) => 
        toLocalDateKey(m.StartDate, startHour) === dateKey
      );
      setSelectedDateMeetings(dateMeetings);
    } catch {
      setSelectedDateLogs([]);
      setSelectedDateMeetings([]);
    } finally {
      setLoadingDate(false);
    }
  }, [userDetails, startHour]);

  // Initial load - fetch monthly meta and today's details
  useEffect(() => {
    if (!userDetails) return;
    fetchMonthlyMeta();
    fetchDateDetails(toLocalDateKey(today, startHour));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDetails?.ReferenceID, currentMonth.getMonth(), currentMonth.getFullYear()]);

  // Handle date selection
  const handleDateSelect = useCallback((dateKey: string) => {
    setSelectedDate(dateKey);
    fetchDateDetails(dateKey);
  }, [fetchDateDetails]);

  const filteredItems = useMemo(() => {
    let items: (ActivityLog | Meeting)[] = [...selectedDateLogs, ...selectedDateMeetings];
    
    if (activeFilter === "All") return items;
    if (activeFilter === "Login") return items.filter((l): l is ActivityLog => 'Status' in l && l.Status === "Login");
    if (activeFilter === "Logout") return items.filter((l): l is ActivityLog => 'Status' in l && l.Status === "Logout");
    if (activeFilter === "Site Visit") return items.filter((l): l is ActivityLog => 'Type' in l && l.Type === "Client Visit");
    if (activeFilter === "Meeting") return items.filter((l): l is Meeting => 'Title' in l);
    return items;
  }, [selectedDateLogs, selectedDateMeetings, activeFilter]);

  const presentRate = monthlyStats.total > 0 ? Math.round((monthlyStats.present / monthlyStats.total) * 100) : 0;
  
  // Build meta lookup for quick access
  const metaLookup = useMemo(() => {
    const map = new Map<string, DateMeta>();
    monthlyMeta.forEach(m => map.set(m.dateKey, m));
    return map;
  }, [monthlyMeta]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 pt-12 pb-5 flex-shrink-0" style={{ background: "linear-gradient(145deg,var(--brand-primary) 0%,var(--brand-primary-hover) 100%)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-white text-[17px] font-semibold">{currentMonth.toLocaleDateString("en-PH", { month: "long" })}</p>
            <p className="text-white/60 text-[12px]">Activity Calendar · {currentMonth.getFullYear()}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onCreateMeeting} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors" title="Create Meeting"><Plus size={16} /></button>
            <button onClick={goToPrevMonth} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"><ChevronLeft size={14} /></button>
            <button onClick={goToNextMonth} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"><ChevronRight size={14} /></button>
          </div>
        </div>
        <div className="flex gap-4">
          {[{ label: "Present", value: monthlyStats.present }, { label: "Absent", value: monthlyStats.absent }, { label: "Visits", value: monthlyStats.visits }, { label: "Rate", value: `${presentRate}%` }].map((s) => (
            <div key={s.label} className="flex-1 text-center">
              <p className="text-white text-[20px] font-semibold leading-tight">{s.value}</p>
              <p className="text-white/60 text-[9px] uppercase tracking-wider mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white mx-4 rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="grid grid-cols-7 border-b border-gray-100">
            {DAY_NAMES.map((d, i) => <div key={i} className="text-center py-2.5 text-[10px] font-semibold text-gray-400 uppercase">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {calendarDays.map((date, idx) => {
              const dateKey = toLocalDateKey(date);
              const meta = metaLookup.get(dateKey);
              const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
              const isToday = isSameDay(date, today);
              const isSelected = selectedDate === dateKey;
              const hasLogin = meta?.hasLogin ?? false;
              const hasLogout = meta?.hasLogout ?? false;
              const hasMeeting = meta?.hasMeeting ?? false;

              return (
                <button
                  key={idx}
                  onClick={() => handleDateSelect(dateKey)}
                  disabled={loadingMeta}
                  className={[
                    "aspect-square flex flex-col items-center justify-start pt-1.5 pb-1 transition-all active:scale-95",
                    isToday ? "ring-2 ring-inset ring-[var(--brand-primary)]" : "",
                    isSelected ? "bg-[var(--brand-light)]" : "",
                    isCurrentMonth ? "" : "opacity-30",
                    loadingMeta ? "opacity-50" : ""
                  ].join(" ")}
                >
                  <span className={[
                    "text-[12px] font-semibold w-6 h-6 flex items-center justify-center rounded-lg transition-colors",
                    isToday ? "bg-[var(--brand-primary)] text-white" : isSelected ? "text-[var(--brand-primary)]" : "text-gray-700"
                  ].join(" ")}>{date.getDate()}</span>
                  <div className="flex gap-0.5 mt-0.5">
                    {hasLogin && <span className="w-1 h-1 rounded-full bg-[#1A7A4A]" />}
                    {hasLogout && <span className="w-1 h-1 rounded-full bg-[var(--brand-primary)]" />}
                    {hasMeeting && <span className="w-1 h-1 rounded-full bg-purple-500" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-4 px-5 mt-3 mb-4 flex-wrap">
          {[{ color: "#1A7A4A", label: "Login" }, { color: "var(--brand-primary)", label: "Logout" }, { color: "#A855F7", label: "Meeting" }, { color: "var(--brand-primary)", label: "Selected", rounded: true }].map((l) => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 flex-shrink-0 ${l.rounded ? "rounded-sm" : "rounded-full"}`} style={{ background: l.color }} />
              <span className="text-[11px] text-gray-500">{l.label}</span>
            </div>
          ))}
        </div>

        <div className="px-5 mb-3 flex items-center justify-between">
          <p className="text-[13px] font-bold text-gray-800">
            Activities for {new Date(selectedDate).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
          </p>
          {filteredItems.length > 0 && (
            <span className="text-[10px] font-semibold text-[var(--brand-primary)] bg-[var(--brand-light)] px-2 py-0.5 rounded-full">
              {filteredItems.length} record{filteredItems.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="px-4 flex flex-col gap-3">
          {loadingDate ? (
            <div className="bg-white rounded-2xl border border-gray-100 px-4 py-8 text-center flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-300 animate-pulse">
                <CalendarCheck size={20} />
              </div>
              <p className="text-[12px] text-gray-400">Loading activities...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 px-4 py-8 text-center flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-300">
                <CalendarCheck size={20} />
              </div>
              <p className="text-[12px] text-gray-400">No activity recorded for this date.</p>
            </div>
          ) : (
            filteredItems.map((item: ActivityLog | Meeting) => {
              if ('Title' in item) {
                // Render Meeting
                const meeting = item as Meeting;
                const user = usersMap[meeting.ReferenceID];
                return (
                  <button key={meeting._id ?? meeting.CreatedAt} onClick={() => onMeetingClick(meeting)} className="w-full bg-white rounded-2xl border border-gray-100 p-4 text-left hover:border-purple-200 hover:bg-purple-50/30 transition-all active:scale-[0.98] shadow-sm flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-[14px] bg-purple-50 flex items-center justify-center flex-shrink-0">
                        <Users size={18} className="text-purple-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold text-gray-800">{meeting.Title}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{user ? `${user.Firstname} ${user.Lastname}` : meeting.Email}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[13px] font-bold text-gray-700 tabular-nums">
                          {new Date(meeting.StartDate).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })}
                        </p>
                        <p className="text-[10px] text-purple-600 font-bold">{meeting.Duration} mins</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 border-t border-gray-50 pt-3">
                      <div className="flex items-start gap-2">
                        <MapPin size={12} className="text-gray-400 mt-0.5" />
                        <p className="text-[11px] text-gray-500 leading-snug">{meeting.Location || "No location set"}</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Info size={12} className="text-gray-400 mt-0.5" />
                        <p className="text-[11px] text-gray-400 italic">
                          {meeting.Remarks && meeting.Remarks !== "No remarks" ? `"${meeting.Remarks}"` : "No remarks added"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              } else {
                // Render ActivityLog
                const log = item as ActivityLog;
                const user = usersMap[log.ReferenceID];
                const isLogin = log.Status === "Login";
                return (
                  <button key={log._id ?? log.date_created} onClick={() => onEventClick(log)} className="w-full bg-white rounded-2xl border border-gray-100 p-4 text-left hover:border-gray-200 hover:bg-gray-50 transition-all active:scale-[0.98] shadow-sm flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-[14px] flex items-center justify-center flex-shrink-0 ${isLogin ? "bg-[#EEF7F2]" : log.Type === "Client Visit" ? "bg-[#FDF4E7]" : "bg-[#FEF0F0]"}`}>
                        {isLogin ? <LogIn size={18} className="text-[#1A7A4A]" /> : log.Type === "Client Visit" ? <Building2 size={18} className="text-[#A0611A]" /> : <LogOut size={18} className="text-[#CC1318]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold text-gray-800">{log.Status} – {log.Type}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{user ? `${user.Firstname} ${user.Lastname}` : log.Email}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[13px] font-bold text-gray-700 tabular-nums">{new Date(log.date_created).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })}</p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 border-t border-gray-50 pt-3">
                      <div className="flex items-start gap-2">
                        <MapPin size={12} className="text-gray-400 mt-0.5" />
                        <p className="text-[11px] text-gray-500 leading-snug">{log.Location || "No location captured"}</p>
                      </div>

                      {log.Type === "Client Visit" && log.SiteVisitAccount && (
                        <div className="flex items-start gap-2">
                          <Building2 size={12} className="text-gray-400 mt-0.5" />
                          <p className="text-[11px] text-gray-600 font-semibold italic">Client: {log.SiteVisitAccount}</p>
                        </div>
                      )}

                      <div className="flex items-start gap-2">
                        <Info size={12} className="text-gray-400 mt-0.5" />
                        <p className="text-[11px] text-gray-400 italic">
                          {log.Remarks && log.Remarks !== "No remarks" ? `"${log.Remarks}"` : "No remarks added"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              }
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reports Tab ───────────────────────────────────────────────────────────────

function ReportsTab({ monthlyStats, allLogs, userId }: {
  monthlyStats: { present: number; absent: number; visits: number; total: number };
  allLogs: ActivityLog[];
  userId: string | null | undefined;
}) {
  const presentRate = monthlyStats.total > 0 ? Math.round((monthlyStats.present / monthlyStats.total) * 100) : 0;
  const loginCount = allLogs.filter((l) => l.Status === "Login").length;
  const logoutCount = allLogs.filter((l) => l.Status === "Logout").length;
  const visitCount = allLogs.filter((l) => l.Type === "Client Visit").length;
  const router = useRouter();

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-12 pb-6 flex-shrink-0" style={{ background: "linear-gradient(145deg,var(--brand-primary) 0%,var(--brand-primary-hover) 100%)" }}>
        <p className="text-white/65 text-[12px] mb-1">Monthly Overview</p>
        <h2 className="text-white text-[20px] font-semibold">Attendance Reports</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-28">
        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { label: "Present Days", value: monthlyStats.present, icon: <CalendarCheck size={16} />, color: "#1A7A4A", bg: "#EEF7F2" },
            { label: "Absent Days", value: monthlyStats.absent, icon: <X size={16} />, color: "var(--brand-primary)", bg: "var(--brand-light)" },
            { label: "Site Visits", value: monthlyStats.visits, icon: <Building2 size={16} />, color: "#A0611A", bg: "#FDF4E7" },
            { label: "Attendance Rate", value: `${presentRate}%`, icon: <TrendingUp size={16} />, color: "#185FA5", bg: "#E6F1FB" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="w-8 h-8 rounded-[10px] flex items-center justify-center mb-3" style={{ background: s.bg, color: s.color }}>{s.icon}</div>
              <p className="text-[22px] font-semibold text-gray-900">{s.value}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Activity Breakdown</p>
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-5">
          {[
            { label: "Login Records", value: loginCount, color: "#1A7A4A" },
            { label: "Logout Records", value: logoutCount, color: "var(--brand-primary)" },
            { label: "Client Visits", value: visitCount, color: "#A0611A" },
          ].map((row, i) => (
            <div key={row.label} className={`flex items-center justify-between px-4 py-3 ${i < 2 ? "border-b border-gray-50" : ""}`}>
              <div className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: row.color }} />
                <span className="text-[13px] text-gray-700 font-medium">{row.label}</span>
              </div>
              <span className="text-[13px] font-bold" style={{ color: row.color }}>{row.value}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Tools</p>
        <TimesheetNavCard userId={userId} />
        
        {/* GPS Report Card */}
        <button
          onClick={() => router.push(`/gps-report?id=${encodeURIComponent(userId || "")}`)}
          className="w-full flex items-center gap-4 bg-white rounded-2xl border border-gray-100 px-4 py-4 text-left hover:border-[var(--brand-primary)]/30 hover:bg-[var(--brand-light)] active:scale-[0.98] transition-all group shadow-sm mt-3"
        >
          <div className="w-11 h-11 rounded-[14px] bg-[#FDF4E7] flex items-center justify-center flex-shrink-0 group-hover:bg-[#A0611A] transition-colors">
            <MapPin size={20} className="text-[#A0611A] group-hover:text-white transition-colors" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-gray-800">Submit GPS Report</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Offline attendance verification</p>
          </div>
          <div className="w-7 h-7 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-[#A0611A] transition-colors">
            <ChevronRight size={13} className="text-gray-400 group-hover:text-white transition-colors" />
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Admin Tab ─────────────────────────────────────────────────────────────────

function AdminTab({ userId }: { userId: string | null | undefined }) {
  const router = useRouter();

  const adminTools = [
    {
      title: "GPS Reports",
      description: "Review offline attendance submissions",
      icon: <MapPin size={20} className="text-[#185FA5]" />,
      href: `/admin/gps-reports${userId ? `?id=${encodeURIComponent(userId)}` : ""}`,
      color: "bg-[#E6F1FB]",
    },
    {
      title: "Attendance Summary",
      description: "Payroll export and summary logs",
      icon: <FileSpreadsheet size={20} className="text-[#1A7A4A]" />,
      href: `/admin/attendance-summary${userId ? `?id=${encodeURIComponent(userId)}` : ""}`,
      color: "bg-[#EEF7F2]",
    },
    {
      title: "Live Tracking",
      description: "Monitor real-time field locations",
      icon: <MapPin size={20} className="text-[#A0611A]" />,
      href: `/admin/live-tracking${userId ? `?id=${encodeURIComponent(userId)}` : ""}`,
      color: "bg-[#FDF4E7]",
    },
    {
      title: "System Settings",
      description: "Configure work rules and announcements",
      icon: <Settings size={20} className="text-purple-600" />,
      href: `/admin/settings${userId ? `?id=${encodeURIComponent(userId)}` : ""}`,
      color: "bg-purple-50",
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-5 pt-12 pb-10 flex-shrink-0"
        style={{ background: "linear-gradient(145deg,var(--brand-primary) 0%,var(--brand-primary-hover) 100%)" }}
      >
        <p className="text-white/65 text-[12px] mb-1">Administrator Panel</p>
        <h2 className="text-white text-[20px] font-semibold">System Control</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-32">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4">Admin Tools</p>
        <div className="grid grid-cols-1 gap-3">
          {adminTools.map((tool) => (
            <button
              key={tool.title}
              onClick={() => router.push(tool.href)}
              className="w-full flex items-center gap-4 bg-white rounded-2xl border border-gray-100 p-4 text-left hover:border-[var(--brand-primary)]/30 hover:bg-[var(--brand-light)] active:scale-[0.98] transition-all group shadow-sm"
            >
              <div className={`w-11 h-11 rounded-[14px] ${tool.color} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                {tool.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-gray-800">{tool.title}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{tool.description}</p>
              </div>
              <div className="w-7 h-7 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--brand-primary)] transition-colors">
                <ArrowRight size={13} className="text-gray-400 group-hover:text-white transition-colors" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────────

function ProfileTab({
  userDetails,
  userId,
  isActive,
  onLogout,
  onFaceRegister,
  onBiometricRegister,
  onUpdateSecondaryEmail,
  onUpdateFaceVerification,
}: {
  userDetails: UserDetails | null;
  userId: string | null | undefined;
  isActive: boolean;
  onLogout: () => void;
  onFaceRegister: () => void;
  onBiometricRegister: () => void;
  onUpdateSecondaryEmail: (email: string) => void;
  onUpdateFaceVerification: (enabled: boolean) => void;
}) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [secondaryEmail, setSecondaryEmail] = useState(userDetails?.SecondaryEmail || "");
  const [pin, setPin] = useState(userDetails?.pin || "");
  const [emailUpdating, setEmailUpdating] = useState(false);
  const [pinUpdating, setPinUpdating] = useState(false);

  // PWA Install Prompt
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Capture the beforeinstallprompt event
  useEffect(() => {
    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Detect iOS — Safari on iPhone/iPad never fires beforeinstallprompt
    const ua = navigator.userAgent;
    const iosDevice = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream;
    if (iosDevice) {
      setIsIOS(true);
      setIsInstallable(true); // show the button so user can get instructions
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      toast.success('App installed successfully!');
    }
    setDeferredPrompt(null);
    setIsInstallable(false);
  };

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/auth/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch {
      /* silent */
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) fetchSessions();
  }, [fetchSessions, isActive]);

  useEffect(() => {
    if (userDetails?.SecondaryEmail) {
      setSecondaryEmail(userDetails.SecondaryEmail);
    }
    if (userDetails?.pin) {
      setPin(userDetails.pin);
    }
  }, [userDetails?.SecondaryEmail, userDetails?.pin]);

  const handleUpdateEmail = async () => {
    setEmailUpdating(true);
    try {
      await onUpdateSecondaryEmail(secondaryEmail);
      toast.success("Secondary email updated");
    } catch (e) {
      toast.error("Failed to update email");
    } finally {
      setEmailUpdating(false);
    }
  };

  const handleUpdatePin = async () => {
    if (!userId || pin.length !== 6) {
      toast.error("PIN must be 6 digits");
      return;
    }
    setPinUpdating(true);
    try {
      const res = await fetch("/api/profile-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pin }),
      });
      if (res.ok) {
        toast.success("Login PIN updated successfully");
      } else {
        throw new Error("Failed to update PIN");
      }
    } catch (e) {
      toast.error("Failed to update PIN");
    } finally {
      setPinUpdating(false);
    }
  };

  const toggleTwoFactor = async () => {
    if (!userDetails) return;
    setTwoFactorLoading(true);
    const newStatus = !userDetails.twoFactorEnabled;
    try {
      const res = await fetch("/api/auth/2fa-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newStatus }),
      });
      if (res.ok) {
        toast.success(`2FA ${newStatus ? "enabled" : "disabled"}`);
        // We might want to refresh userDetails here, but for simplicity we'll just show the toast
        // and wait for the next render/refresh
      } else {
        toast.error("Failed to update 2FA status");
      }
    } catch (e) {
      toast.error("An error occurred");
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      const res = await fetch("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (res.ok) {
        toast.success("Device session revoked");
        fetchSessions();
      }
    } catch (e) {
      toast.error("Failed to revoke session");
    }
  };

  const initials = userDetails
    ? `${userDetails.Firstname[0] ?? ""}${userDetails.Lastname[0] ?? ""}`.toUpperCase()
    : "?";

  const hasBiometrics = (userDetails?.faceDescriptors && userDetails.faceDescriptors.length > 0) || (userDetails?.credentials && userDetails.credentials.length > 0);

  const fields = userDetails ? [
    { label: "Email", value: userDetails.Email },
    { label: "Role", value: userDetails.Role },
    { label: "Department", value: userDetails.Department },
    { label: "Company", value: userDetails.Company ?? "—" },
    { label: "Reference ID", value: userDetails.ReferenceID },
    { label: "Fingerprint Auth", value: userDetails.credentials && userDetails.credentials.length > 0 ? "Registered" : "Not Registered" },
    { label: "Face Scan", value: userDetails.faceDescriptors ? "Registered" : "Not Registered" },
  ] : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="px-5 pt-12 pb-10 flex-shrink-0 flex flex-col items-center"
        style={{ background: "linear-gradient(145deg,var(--brand-primary) 0%,var(--brand-primary-hover) 100%)" }}
      >
        {userDetails?.profilePicture ? (
          <img src={userDetails.profilePicture} alt="" className="w-20 h-20 rounded-full border-4 border-white/30 object-cover mb-3" />
        ) : (
          <div className="w-20 h-20 rounded-full bg-white/20 border-4 border-white/30 flex items-center justify-center text-white text-2xl font-bold mb-3">
            {initials}
          </div>
        )}
        <h2 className="text-white text-[18px] font-semibold">
          {userDetails ? `${userDetails.Firstname} ${userDetails.Lastname}` : "Loading..."}
        </h2>
        <p className="text-white/65 text-[12px] mt-1">{userDetails?.Role ?? "—"}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-32">
        {/* User info */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-5">
          {fields.map((f, i) => (
            <div key={f.label} className={`flex items-center justify-between px-4 py-3.5 ${i < fields.length - 1 ? "border-b border-gray-50" : ""}`}>
              <span className="text-[12px] font-semibold text-gray-400">{f.label}</span>
              <span className={`text-[13px] font-medium text-right max-w-[60%] truncate ${f.label === "Biometrics" && f.value === "Not Registered" ? "text-[var(--brand-primary)]" : "text-gray-800"}`}>{f.value}</span>
            </div>
          ))}
        </div>

        {/* Security Section */}
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Settings & Security</p>
        <div className="flex flex-col gap-3 mb-5">
          {/* Secondary Email Notification */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-[14px] bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0">
                <Globe size={20} className="text-[var(--brand-primary)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-gray-800">Notification Email</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Receive 2FA codes on another email</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                value={secondaryEmail}
                onChange={(e) => setSecondaryEmail(e.target.value)}
                placeholder="backup@email.com"
                className="flex-1 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[12px] outline-none focus:border-[var(--brand-primary)] transition-all"
              />
              <button
                onClick={handleUpdateEmail}
                disabled={emailUpdating || secondaryEmail === userDetails?.SecondaryEmail}
                className="bg-[var(--brand-primary)] text-white text-[11px] font-bold px-4 rounded-xl disabled:opacity-30 transition-all"
              >
                {emailUpdating ? "..." : "Save"}
              </button>
            </div>
          </div>

          {/* Login PIN Setup */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-[14px] bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0">
                <ShieldCheck size={20} className="text-[var(--brand-primary)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-gray-800">Login PIN</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Set a 6-digit PIN for faster login</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="Set 6-digit PIN"
                className="flex-1 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[12px] font-bold tracking-[4px] outline-none focus:border-[var(--brand-primary)] transition-all"
              />
              <button
                onClick={handleUpdatePin}
                disabled={pinUpdating || pin.length !== 6 || pin === userDetails?.pin}
                className="bg-[var(--brand-primary)] text-white text-[11px] font-bold px-4 rounded-xl disabled:opacity-30 transition-all"
              >
                {pinUpdating ? "..." : "Update PIN"}
              </button>
            </div>
          </div>

          {/* 2FA Toggle */}
          <div className="w-full flex items-center gap-4 bg-white rounded-2xl border border-gray-100 px-4 py-4 text-left shadow-sm">
            <div className="w-11 h-11 rounded-[14px] bg-[#EEF7F2] flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={20} className="text-[#1A7A4A]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-800">2-Step Verification</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Protect account with email OTP</p>
            </div>
            <button
              onClick={async () => {
                if (!userId) return;
                const newStatus = !(userDetails?.twoFactorEnabled !== false);
                try {
                  const res = await fetch("/api/profile-update", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId, twoFactorEnabled: newStatus }),
                  });
                  if (res.ok) {
                    toast.success(`2FA ${newStatus ? "enabled" : "disabled"}`);
                    onUpdateFaceVerification(newStatus);
                  } else {
                    toast.error("Failed to update face verification");
                  }
                } catch (e) {
                  toast.error("An error occurred");
                }
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${userDetails?.twoFactorEnabled ? 'bg-[var(--brand-primary)]' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${userDetails?.twoFactorEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Face Verification Toggle */}
          <div className="w-full flex items-center gap-4 bg-white rounded-2xl border border-gray-100 px-4 py-4 text-left shadow-sm">
            <div className="w-11 h-11 rounded-[14px] bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0">
              <User size={20} className="text-[var(--brand-primary)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-800">Face Verification</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {userDetails?.faceVerificationEnabled !== false ? "Require face match for attendance" : "Regular photo only (no face check)"}
              </p>
            </div>
            <button
              onClick={async () => {
                if (!userId) return;
                const newStatus = !(userDetails?.faceVerificationEnabled !== false);
                try {
                  const res = await fetch("/api/profile-update", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId, faceVerificationEnabled: newStatus }),
                  });
                  if (res.ok) {
                    toast.success(`Face verification ${newStatus ? "enabled" : "disabled"}`);
                    onUpdateFaceVerification(newStatus);
                  } else {
                    toast.error("Failed to update face verification");
                  }
                } catch (e) {
                  toast.error("An error occurred");
                }
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${userDetails?.faceVerificationEnabled !== false ? 'bg-[var(--brand-primary)]' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${userDetails?.faceVerificationEnabled !== false ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <button
            onClick={onFaceRegister}
            className="w-full flex items-center gap-4 bg-white rounded-2xl border border-gray-100 px-4 py-4 text-left hover:border-[var(--brand-primary)]/30 hover:bg-[var(--brand-light)] active:scale-[0.98] transition-all group shadow-sm"
          >
            <div className="w-11 h-11 rounded-[14px] bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--brand-primary)] transition-colors">
              <User size={20} className="text-[var(--brand-primary)] group-hover:text-white transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-800">Face Registration</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{userDetails?.faceDescriptors ? "Update your face biometric data" : "Register your face for verification"}</p>
            </div>
            <div className="w-7 h-7 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--brand-primary)] transition-colors">
              <ArrowRight size={13} className="text-gray-400 group-hover:text-white transition-colors" />
            </div>
          </button>

          <button
            onClick={onBiometricRegister}
            className="w-full flex items-center gap-4 bg-white rounded-2xl border border-gray-100 px-4 py-4 text-left hover:border-[#CC1318]/30 hover:bg-[#FFF8F8] active:scale-[0.98] transition-all group shadow-sm"
          >
            <div className="w-11 h-11 rounded-[14px] bg-[#E6F1FB] flex items-center justify-center flex-shrink-0 group-hover:bg-[#185FA5] transition-colors">
              <Fingerprint size={20} className="text-[#185FA5] group-hover:text-white transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-800">Fingerprint / Biometrics</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{userDetails?.credentials && userDetails.credentials.length > 0 ? "Update your fingerprint data" : "Register fingerprint for faster login"}</p>
            </div>
            <div className="w-7 h-7 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-[#185FA5] transition-colors">
              <ArrowRight size={13} className="text-gray-400 group-hover:text-white transition-colors" />
            </div>
          </button>

          {/* iOS Step-by-step guide modal */}
          {showIOSGuide && (
            <div
              className="fixed inset-0 z-[200] flex items-end justify-center"
              style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
              onClick={() => setShowIOSGuide(false)}
            >
              <div
                className="w-full max-w-sm bg-white rounded-t-[32px] p-6 pb-10 shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-11 h-11 rounded-[14px] bg-purple-100 flex items-center justify-center flex-shrink-0">
                    <Download size={20} className="text-purple-600" />
                  </div>
                  <div>
                    <p className="text-[15px] font-bold text-gray-900">Install on iPhone / iPad</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Follow these 3 steps in Safari</p>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  {[
                    { step: "1", icon: "⬆️", text: "Tap the Share button at the bottom of Safari (the box with an arrow pointing up)" },
                    { step: "2", icon: "➕", text: 'Scroll down and tap "Add to Home Screen"' },
                    { step: "3", icon: "✅", text: 'Tap "Add" in the top-right corner — the app icon will appear on your home screen' },
                  ].map(({ step, icon, text }) => (
                    <div key={step} className="flex items-start gap-3 bg-gray-50 rounded-2xl p-3.5 border border-gray-100">
                      <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0 text-white text-[11px] font-bold">
                        {step}
                      </div>
                      <p className="text-[12px] text-gray-700 leading-relaxed flex-1">
                        <span className="mr-1">{icon}</span>{text}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 text-center mt-4">
                  Make sure you are using <span className="font-bold text-gray-600">Safari</span> — Chrome on iOS does not support installation.
                </p>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="w-full mt-4 py-3.5 bg-purple-600 text-white rounded-2xl font-bold text-[14px] active:scale-95 transition-all"
                >
                  Got it
                </button>
              </div>
            </div>
          )}

          <TimesheetNavCard userId={userId} />
        </div>

        {/* ── Customize (App Preferences) ── */}
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Customize</p>
        <CustomizePanel />

        {/* ── Permanent Install App Section ── */}
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Install App on Phone</p>
        <InstallAppSection
          isInstalled={isInstalled}
          isIOS={isIOS}
          isInstallable={isInstallable}
          onInstallClick={handleInstallClick}
        />

        {/* Device Sessions */}
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Logged Devices</p>
        <div className="flex flex-col gap-3 mb-5">
          {sessionsLoading ? (
            <div className="p-4 text-center text-[12px] text-gray-400">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-center text-[12px] text-gray-400">No active sessions</div>
          ) : (
            sessions.map((session) => {
              const isCurrent = session.token === document.cookie.split('; ').find(row => row.startsWith('session='))?.split('=')[1];
              return (
                <div key={session._id} className="w-full flex items-center gap-4 bg-white rounded-2xl border border-gray-100 px-4 py-4 shadow-sm">
                  <div className={`w-11 h-11 rounded-[14px] flex items-center justify-center flex-shrink-0 ${isCurrent ? 'bg-[#EEF7F2]' : 'bg-gray-50'}`}>
                    {session.os?.toLowerCase().includes("win") || session.os?.toLowerCase().includes("mac") ? (
                      <Laptop size={20} className={isCurrent ? 'text-[#1A7A4A]' : 'text-gray-400'} />
                    ) : (
                      <Smartphone size={20} className={isCurrent ? 'text-[#1A7A4A]' : 'text-gray-400'} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-gray-800 truncate">{session.device || session.os}</p>
                      {isCurrent && (
                        <span className="px-1.5 py-0.5 rounded-md bg-[#EEF7F2] text-[#1A7A4A] text-[9px] font-bold uppercase tracking-wider">This Device</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Globe size={10} className="text-gray-300" />
                      <p className="text-[11px] text-gray-400 truncate">{session.ip || 'Unknown IP'}</p>
                    </div>
                  </div>
                  {!isCurrent && (
                    <button
                      onClick={() => revokeSession(session._id)}
                      className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-[#FEF0F0] hover:text-[#CC1318] transition-all active:scale-95"
                      title="Kick out device"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── Logout ── */}
        <div className="mt-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Account</p>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-4 bg-white rounded-2xl border border-gray-100 px-4 py-4 text-left hover:border-red-200 hover:bg-[var(--brand-light)] active:scale-[0.98] transition-all group"
          >
            <div className="w-11 h-11 rounded-[14px] bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--brand-primary)] transition-colors">
              <Power size={18} className="text-[var(--brand-primary)] group-hover:text-white transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[var(--brand-primary)]">Log Out</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Sign out of your account</p>
            </div>
            <div className="w-7 h-7 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--brand-primary)] transition-colors">
              <ArrowRight size={13} className="text-gray-400 group-hover:text-white transition-colors" />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Customize Panel (User Preferences) ───────────────────────────────────────

function CustomizePanel() {
  const { prefs, setPref } = usePreferences();
  let items: { key: keyof typeof prefs; label: string; desc: string; emoji: string; sample?: () => void }[] = [
    { key: "haptics",             label: "Haptic Feedback",       desc: "Vibrate on taps and actions",          emoji: "📳", sample: () => haptic("medium") },
    { key: "notificationSound",   label: "Notification Sound",    desc: "Play a chime for new alerts",          emoji: "🔔", sample: () => playNotificationSound() },
    { key: "notificationVibrate", label: "Vibrate on Notification", desc: "Buzz when a new notification arrives", emoji: "📲" },
    { key: "pushNotifications",   label: "Push Notifications",    desc: "Receive alerts from the server",       emoji: "📨" },
    { key: "showWeather",         label: "Weather on Home",       desc: "Display the weather card",             emoji: "🌤️" },
    { key: "swipeToRefresh",      label: "Swipe to Refresh",      desc: "Pull down to reload data",             emoji: "↕️" },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm mb-5">
      {items.map((it, i) => (
        <div
          key={String(it.key)}
          className={`flex items-center gap-4 px-4 py-3.5 ${i < items.length - 1 ? "border-b border-gray-50" : ""}`}
        >
          <div className="w-10 h-10 rounded-[12px] bg-gray-50 flex items-center justify-center flex-shrink-0 text-[18px]">
            {it.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-gray-800">{it.label}</p>
            <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{it.desc}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !prefs[it.key];
              setPref(it.key, next);
              if (next && it.sample) {
                // small delay so the pref is read by the sampler
                setTimeout(() => it.sample && it.sample(), 50);
              }
              haptic("light");
            }}
            aria-pressed={prefs[it.key]}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none flex-shrink-0 ${prefs[it.key] ? "bg-[var(--brand-primary)]" : "bg-gray-200"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${prefs[it.key] ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Install App Section (permanent, platform-aware) ──────────────────────────

function InstallAppSection({
  isInstalled,
  isIOS,
  isInstallable,
  onInstallClick,
}: {
  isInstalled: boolean;
  isIOS: boolean;
  isInstallable: boolean;
  onInstallClick: () => void;
}) {
  const [platform, setPlatform] = useState<"ios" | "android">(isIOS ? "ios" : "android");

  useEffect(() => {
    setPlatform(isIOS ? "ios" : "android");
  }, [isIOS]);

  const iosSteps = [
    { icon: "🌐", text: "Open this site in Safari (not Chrome)" },
    { icon: "⬆️", text: "Tap the Share button at the bottom of the screen" },
    { icon: "➕", text: 'Scroll down and tap "Add to Home Screen"' },
    { icon: "✅", text: 'Tap "Add" — the Biolog icon will appear on your home screen' },
  ];

  const androidSteps = [
    { icon: "🌐", text: "Open this site in Chrome (or any modern browser)" },
    { icon: "⋮",  text: "Tap the three-dot menu in the top-right corner" },
    { icon: "📲", text: 'Tap "Install app" or "Add to Home screen"' },
    { icon: "✅", text: "Confirm — Biolog opens like a real app, even offline" },
  ];

  const steps = platform === "ios" ? iosSteps : androidSteps;

  if (isInstalled) {
    return (
      <div className="bg-white rounded-2xl border border-green-100 overflow-hidden mb-5 shadow-sm">
        <div className="flex items-center gap-4 px-4 py-4 bg-gradient-to-r from-green-50 to-emerald-50">
          <div className="w-11 h-11 rounded-[14px] bg-green-100 flex items-center justify-center flex-shrink-0">
            <Download size={20} className="text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-green-800">App Installed</p>
            <p className="text-[11px] text-green-600 mt-0.5">You're using the installed Biolog app — long-press the icon for shortcuts.</p>
          </div>
        </div>
        <div className="px-4 py-3 bg-white">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            <span className="font-semibold text-gray-600">Tip:</span> Long-press the Biolog icon on your phone to quickly create an attendance or site visit without opening the app first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-5 shadow-sm">
      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        {(["android", "ios"] as const).map((p) => (
          <button
            key={p}
            onClick={() => { setPlatform(p); haptic("light"); }}
            className={`flex-1 py-3 text-[12px] font-bold transition-all ${platform === p ? "text-[var(--brand-primary)] bg-[var(--brand-light)]" : "text-gray-400"}`}
          >
            {p === "ios" ? "📱 iPhone / iPad" : "🤖 Android"}
          </button>
        ))}
      </div>

      {/* CTA Button (only when supported by the browser) */}
      {isInstallable && (
        <div className="p-4 border-b border-gray-100">
          <button
            onClick={onInstallClick}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-[13px] font-bold shadow-md shadow-purple-200 active:scale-[0.98] transition-all"
          >
            <Download size={16} />
            {platform === "ios" ? "Show Install Steps" : "Install App Now"}
          </button>
        </div>
      )}

      {/* Step-by-step */}
      <div className="p-4">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">
          {platform === "ios" ? "Install on iPhone / iPad" : "Install on Android"}
        </p>
        <div className="flex flex-col gap-2.5">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-2xl p-3 border border-gray-100">
              <div className="w-7 h-7 rounded-full bg-[var(--brand-primary)] flex items-center justify-center flex-shrink-0 text-white text-[11px] font-bold">
                {i + 1}
              </div>
              <p className="text-[12px] text-gray-700 leading-relaxed flex-1">
                <span className="mr-1.5">{s.icon}</span>{s.text}
              </p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 text-center mt-3 leading-relaxed">
          {platform === "ios" ?"iOS only supports installation from Safari — not Chrome or other browsers." :"After installing, long-press the Biolog icon for quick shortcuts to Attendance and Site Visit."}
        </p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function ActivityPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { userId, setUserId } = useUser();
  const queryUserId = searchParams?.get("id") ?? "";

  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [posts, setPosts] = useState<ActivityLog[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, UserInfo>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateCreatedFilterRange] = useState<DateRange | undefined>(undefined);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [activeTab, setActiveTab] = useState<ActiveTab>("home");
  const [selectedEvent, setSelectedEvent] = useState<ActivityLog | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [meetingDialogOpen, setMeetingDialogOpen] = useState(false);
  const [createAttendanceOpen, setCreateAttendanceOpen] = useState(false);
  const [createSalesAttendanceOpen, setCreateSalesAttendanceOpen] = useState(false);
  const [createMeetingOpen, setCreateMeetingOpen] = useState(false);

  // Handle PWA shortcut launches (?shortcut=attendance | sitevisit)
  useEffect(() => {
    const shortcut = searchParams?.get("shortcut");
    if (!shortcut) return;
    if (shortcut === "attendance") {
      setActiveTab("home");
      setCreateAttendanceOpen(true);
      haptic("medium");
    } else if (shortcut === "sitevisit") {
      setActiveTab("home");
      setCreateSalesAttendanceOpen(true);
      haptic("medium");
    }
    // Clear the param so refresh doesn't reopen
    router.replace("/activity-planner");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [faceRegisterOpen, setFaceRegisterOpen] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [biometricRegistering, setBiometricRegistering] = useState(false);
  const [startHour, setStartHour] = useState(8);

  // Office start hour comes from the same /api/admin/settings call already made
  // higher up in the component — no need to refetch it here.

  const [formData, setFormData] = useState<FormData>({
    ReferenceID: "", Email: "", Type: "", Status: "", PhotoURL: "", Remarks: "", TSM: "",
  });



  const today = new Date();

  // ── Logout ── matches nav-user.tsx logic exactly
  const handleLogout = async () => {
    // Clear offline session so the user can't bypass login while offline
    try {
      const { clearOfflineSession } = await import("@/lib/offline-auth");
      await clearOfflineSession();
    } catch { /* silent */ }
    // Attempt server-side logout (best-effort — works online only)
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch { /* silent — offline */ }
    localStorage.removeItem("userId");
    router.replace("/Login");
  };

  useEffect(() => {
    if (queryUserId && queryUserId !== userId) setUserId(queryUserId);
  }, [queryUserId, userId, setUserId]);

  useEffect(() => {
    if (!queryUserId) { 
      setError("User ID is missing."); 
      setLoading(false); 
      // Auto-redirect to login after short delay
      setTimeout(() => router.replace("/Login"), 1500);
      return; 
    }

    const applyData = (data: any) => {
      setUserDetails({
        UserId: data._id ?? "", Firstname: data.Firstname ?? "", Lastname: data.Lastname ?? "",
        Email: data.Email ?? "", Role: data.Role ?? "", Department: data.Department ?? "",
        Company: data.Company ?? "", ReferenceID: data.ReferenceID ?? "",
        profilePicture: data.profilePicture ?? "", faceDescriptors: data.faceDescriptors ?? null,
        credentials: data.credentials ?? [],
        twoFactorEnabled: data.twoFactorEnabled ?? false,
        SecondaryEmail: data.SecondaryEmail ?? "",
        pin: data.pin ?? "",
        TSM: data.TSM ?? "",
        Directories: data.Directories ?? [],
        permissions: data.permissions ?? { canCreateAttendance: true, canCreateSiteVisit: true },
        faceVerificationEnabled: data.faceVerificationEnabled ?? true,
      });
      setError(null);
    };

    let cancelled = false;
    setLoading(true);

    // ── Stale-while-revalidate: paint cached profile instantly, refresh in background ──
    (async () => {
      try {
        const { getCachedUser, cacheUser } = await import("@/lib/offline-auth");
        const cached = await getCachedUser(queryUserId);
        if (cached && !cancelled) {
          applyData(cached);
          setLoading(false); // shell can render immediately
        }

        // Background refresh from network
        try {
          const res = await fetch(`/api/user?id=${encodeURIComponent(queryUserId)}`);
          if (!res.ok) throw new Error("Failed to fetch user data");
          const fresh = await res.json();
          if (!cancelled) {
            applyData(fresh);
            setLoading(false);
          }
          cacheUser(queryUserId, fresh).catch(() => {});
        } catch {
          if (!cached && !cancelled) {
            setError("Failed to load user data.");
            setLoading(false);
          }
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load user data.");
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [queryUserId]);

  useEffect(() => {
    if (userDetails) setFormData((prev) => ({ ...prev, ReferenceID: userDetails.ReferenceID, Email: userDetails.Email, TSM: userDetails.TSM }));
  }, [userDetails]);


  const fetchAccountAction = useCallback(async () => {
    if (!userDetails) return;
    setLoading(true);

    // ── Stale-while-revalidate: paint cached logs instantly ──
    try {
      const { getCachedLogs } = await import("@/lib/offline-logs-cache");
      const cached = await getCachedLogs();
      if (cached.length > 0) {
        setPosts(cached as unknown as ActivityLog[]);
        setLoading(false); // user sees data immediately while we refresh
      }
    } catch { /* silent */ }

    try {
      const buildParams = (page: number) => {
        const params = new URLSearchParams();
        params.append("page", page.toString());
        params.append("limit", "500"); // larger pages → fewer round-trips
        params.append("role", userDetails.Role);
        if (userDetails.Role !== "SuperAdmin" && userDetails.Role !== "Human Resources") {
          params.append("referenceID", userDetails.ReferenceID);
        }
        if (dateCreatedFilterRange?.from) {
          params.append("startDate", dateCreatedFilterRange.from.toISOString());
          params.append("endDate", (dateCreatedFilterRange.to ?? dateCreatedFilterRange.from).toISOString());
        }
        return params;
      };

      // First page tells us how many total pages exist
      const firstRes = await fetch(`/api/ModuleSales/Activity/FetchLog?${buildParams(1).toString()}`);
      if (!firstRes.ok) throw new Error("Failed to fetch logs");
      const firstData = await firstRes.json();
      const totalPages: number = firstData.pagination?.totalPages ?? 1;
      let allLogs: ActivityLog[] = firstData.data ?? [];

      // Show first page immediately so the UI updates as soon as possible
      setPosts(allLogs);
      setLoading(false);

      // Fetch any remaining pages in PARALLEL instead of sequentially
      if (totalPages > 1) {
        const remaining = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) =>
            fetch(`/api/ModuleSales/Activity/FetchLog?${buildParams(i + 2).toString()}`)
              .then((r) => (r.ok ? r.json() : { data: [] }))
              .catch(() => ({ data: [] }))
          )
        );
        allLogs = remaining.reduce<ActivityLog[]>(
          (acc, d) => acc.concat((d.data ?? []) as ActivityLog[]),
          allLogs
        );
        setPosts(allLogs);
      }

      // Cache for offline use (non-blocking)
      import("@/lib/offline-logs-cache")
        .then(({ cacheLogs }) => cacheLogs(allLogs as any))
        .catch(() => {});
    } catch {
      // Network failed — keep cached posts already painted; if none, show empty
      setPosts((prev) => (prev.length > 0 ? prev : []));
    } finally {
      setLoading(false);
    }
  }, [userDetails, dateCreatedFilterRange]);

  const { pendingCount, isOnline, isSyncing, syncNow } = useOfflineSync(fetchAccountAction);

  // ── Notifications (ticket status changes) ────────────────────────────────
  const { unreadCount: notifUnreadCount, markAllRead: markNotifsRead } = useNotifications(userDetails?.ReferenceID);

  // ── Session timeout warning ───────────────────────────────────────────────
  const { showWarning: showSessionWarning, secondsLeft: sessionSecondsLeft, refresh: refreshSession, dismiss: dismissSessionWarning } = useSessionTimeout();

  // ── User preferences (haptics, sound, notifications, etc.) ───────────────
  const { prefs: appPrefs } = usePreferences();

  // ── Swipe to refresh (home tab) — disabled if user turned it off ─────────
  const { containerRef: swipeContainerRef, pullDistance, isRefreshing: isPullRefreshing } = useSwipeToRefresh(
    async () => {
      haptic("light");
      await Promise.all([fetchAccountAction(), fetchMeetings()]);
    },
    activeTab === "home" && appPrefs.swipeToRefresh
  );

  // ── Push notifications init ───────────────────────────────────────────────
  useEffect(() => {
    if (!userDetails?.UserId) return;
    if (!appPrefs.pushNotifications) return; // user opted out
    import("@/lib/push-notifications").then(({ initPushNotifications, onForegroundMessage }) => {
      initPushNotifications(userDetails.UserId).catch(() => {});
      const unsub = onForegroundMessage(({ title, body }) => {
        toast.info(`${title}: ${body}`, { duration: 6000 });
        playNotificationSound();
        if (appPrefs.notificationVibrate) haptic("warning");
      });
      return unsub;
    }).catch(() => {});
  }, [userDetails?.UserId, appPrefs.pushNotifications, appPrefs.notificationVibrate]);

  // ── Play sound + vibrate when in-app notification count rises ────────────
  const prevNotifCountRef = useRef(0);
  useEffect(() => {
    if (notifUnreadCount > prevNotifCountRef.current && prevNotifCountRef.current !== 0) {
      playNotificationSound();
      if (appPrefs.notificationVibrate) haptic("warning");
    }
    prevNotifCountRef.current = notifUnreadCount;
  }, [notifUnreadCount, appPrefs.notificationVibrate]);

  const fetchMeetings = useCallback(async () => {
    if (!userDetails) return;
    try {
      const params = new URLSearchParams();
      params.append("role", userDetails.Role);
      if (userDetails.Role !== "SuperAdmin" && userDetails.Role !== "Human Resources") {
        params.append("referenceID", userDetails.ReferenceID);
      }
      const res = await fetch(`/api/ModuleSales/Activity/Meeting?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMeetings(data);
      }
    } catch {
      /* silent */
    }
  }, [userDetails]);

  useEffect(() => {
    if (!userDetails) return;
    // Run both fetches in parallel — they're independent.
    Promise.all([fetchAccountAction(), fetchMeetings()]).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDetails, dateCreatedFilterRange]);

  // Debounced usersMap fetch — waits 800ms after last posts/meetings change
  // so incremental page loads don't fire a new /api/users request every 50 logs
  const usersMapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (posts.length === 0 && meetings.length === 0) return;
    if (usersMapTimerRef.current) clearTimeout(usersMapTimerRef.current);
    usersMapTimerRef.current = setTimeout(async () => {
      const uniqueRefs = Array.from(new Set([
        ...posts.map((p) => p.ReferenceID),
        ...meetings.map((m) => m.ReferenceID),
      ]));
      try {
        const res = await fetch(`/api/users?referenceIDs=${uniqueRefs.join(",")}`);
        if (!res.ok) return;
        const usersData = await res.json();
        const map: Record<string, UserInfo> = {};
        usersData.forEach((u: any) => {
          map[u.ReferenceID] = {
            Firstname: u.Firstname, Lastname: u.Lastname,
            profilePicture: u.profilePicture, TSM: u.TSM,
            Directories: u.Directories ?? [],
          };
        });
        setUsersMap(map);
      } catch { /* silent */ }
    }, 800);
    return () => { if (usersMapTimerRef.current) clearTimeout(usersMapTimerRef.current); };
  }, [posts, meetings]);

  const allVisibleAccounts = useMemo(() => {
    if (!userDetails) return [];
    const byRef = posts.filter((p) => p.ReferenceID === userDetails.ReferenceID);
    return userDetails.Role === "SuperAdmin" || userDetails.Department === "Human Resources" ? posts : byRef;
  }, [posts, userDetails]);

  const allVisibleMeetings = useMemo(() => {
    if (!userDetails) return [];
    const byRef = meetings.filter((m) => m.ReferenceID === userDetails.ReferenceID);
    return userDetails.Role === "SuperAdmin" || userDetails.Department === "Human Resources" ? meetings : byRef;
  }, [meetings, userDetails]);

  const groupedByDate = useMemo(() => {
    const g: Record<string, (ActivityLog | Meeting)[]> = {};
    allVisibleAccounts.forEach((p) => {
      const k = toLocalDateKey(p.date_created, startHour);
      if (!g[k]) g[k] = [];
      g[k].push(p);
    });
    allVisibleMeetings.forEach((m) => {
      const k = toLocalDateKey(m.StartDate, startHour);
      if (!g[k]) g[k] = [];
      g[k].push(m);
    });
    return g;
  }, [allVisibleAccounts, allVisibleMeetings, startHour]);

  const calendarDays = useMemo(() => generateCalendarDays(currentMonth.getFullYear(), currentMonth.getMonth()), [currentMonth]);
  const todayKey = toLocalDateKey(today, startHour);
  const todayItems = groupedByDate[todayKey] || [];
  const todayLogs = todayItems.filter((item): item is ActivityLog => 'date_created' in item);

  const todayVisits = useMemo(() => {
    const visits = allVisibleAccounts.filter(
      (p) => (p.Status.toLowerCase() === "login" || p.Status.toLowerCase() === "logout" || p.Type.toLowerCase() === "client visit") && toLocalDateKey(p.date_created, startHour) === todayKey
    );
    const todayMeetings = allVisibleMeetings.filter(
      (m) => toLocalDateKey(m.StartDate, startHour) === todayKey
    );
    return [...visits, ...todayMeetings];
  }, [allVisibleAccounts, allVisibleMeetings, todayKey, startHour]);

  const timelineItems = useMemo<TimelineItem[]>(() => todayVisits.map((p) => {
    if ('Title' in p) {
      return {
        id: p._id ?? p.CreatedAt,
        title: p.Title,
        description: p.Remarks || "Meeting scheduled",
        location: p.Location || "",
        status: "Meeting",
        date: new Date(p.StartDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }),
      };
    } else {
      return {
        id: p._id ?? p.date_created,
        title: p.Type === "Client Visit" ? p.SiteVisitAccount : p.Status,
        description: p.Remarks || "No remarks",
        location: p.Location || "",
        status: p.Status || "",
        date: new Date(p.date_created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }),
      };
    }
  }).sort((a, b) => new Date(b.id).getTime() - new Date(a.id).getTime()),
  [todayVisits]);

  const monthlyStats = useMemo(() => {
    const thisMonthLogs = allVisibleAccounts.filter((p) => {
      const d = new Date(p.date_created);
      return d.getFullYear() === currentMonth.getFullYear() && d.getMonth() === currentMonth.getMonth();
    });
    const loginDays = new Set(thisMonthLogs.filter((l) => l.Status === "Login").map((l) => toLocalDateKey(l.date_created)));
    const visits = thisMonthLogs.filter((l) => l.Type === "Client Visit").length;
    const workDays = calendarDays.filter((d) => d.getMonth() === currentMonth.getMonth() && d.getDay() !== 0 && d.getDay() !== 6).length;
    const present = loginDays.size;
    return { present, absent: Math.max(0, workDays - present), visits, total: workDays };
  }, [allVisibleAccounts, currentMonth, calendarDays]);

  const onChangeAction = (field: keyof FormData, value: any) => setFormData((prev) => ({ ...prev, [field]: value }));
  const onEventClick = (event: ActivityLog) => { setSelectedEvent(event); setDialogOpen(true); };
  const goToPrevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const goToNextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const NAV: { id: ActiveTab; icon: any; label: string }[] = [
    { id: "home", icon: Home, label: "Home" },
    { id: "calendar", icon: CalendarCheck, label: "Calendar" },
    { id: "reports", icon: BarChart3, label: "Reports" },
    { id: "profile", icon: User, label: "Profile" },
  ];

  if (userDetails?.Role === "SuperAdmin" || userDetails?.Role === "Admin" || userDetails?.Department === "IT") {
    NAV.splice(3, 0, { id: "admin", icon: ShieldAlert, label: "Admin" });
  }

  const handleFaceRegister = async (descriptors: number[][]) => {
    if (!userId) return;
    try {
      const res = await fetch("/api/profile-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, faceDescriptors: descriptors }),
      });
      if (!res.ok) throw new Error("Failed to register face");
      toast.success("Biometrics registered successfully!");
      setFaceRegisterOpen(false);
      // Refresh user details
      const userRes = await fetch(`/api/user?id=${encodeURIComponent(userId)}`);
      const userData = await userRes.json();
      setUserDetails(prev => prev ? { ...prev, faceDescriptors: userData.faceDescriptors } : null);
    } catch {
      toast.error("Error saving face data.");
    }
  };

  const handleBiometricRegister = async () => {
    if (!userId || !userDetails) return;
    
    if (biometricRegistering) return;
    setBiometricRegistering(true);

    try {
      // 1. Get registration options from server (or generate locally for WebAuthn)
      // For simplicity, we use a basic WebAuthn implementation
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      
      const userID = userDetails.ReferenceID || userDetails.Email;
      
      const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: {
          name: "Acculog System",
          id: window.location.hostname,
        },
        user: {
          id: Uint8Array.from(userID, c => c.charCodeAt(0)),
          name: userDetails.Email,
          displayName: `${userDetails.Firstname} ${userDetails.Lastname}`,
        },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
        authenticatorSelection: {
          authenticatorAttachment: "platform", // This forces fingerprint/face/pin on device
          userVerification: "required",
          residentKey: "required", // Required for discoverable credentials (login without email)
        },
        timeout: 60000,
        attestation: "none",
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      }) as any;

      if (!credential) throw new Error("Failed to create credential");

      // 2. Send the credential info to profile-update API
      const res = await fetch("/api/profile-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userId, 
          credentials: [{
            id: credential.id,
            type: credential.type,
            rawId: Array.from(new Uint8Array(credential.rawId)),
          }]
        }),
      });

      if (!res.ok) throw new Error("Failed to save biometrics");
      
      toast.success("Biometrics registered successfully!");
      
      // Refresh user details
      const userRes = await fetch(`/api/user?id=${encodeURIComponent(userId)}`);
      const userData = await userRes.json();
      setUserDetails(prev => prev ? { ...prev, credentials: userData.credentials } : null);

    } catch (err: any) {
      if (err?.name !== "NotAllowedError") {
        toast.error(err?.message || "Error registering biometrics.");
      }
    } finally {
      setBiometricRegistering(false);
    }
  };

  const handleUpdateSecondaryEmail = async (email: string) => {
    if (!userId) return;
    try {
      const res = await fetch("/api/profile-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, SecondaryEmail: email }),
      });
      if (res.ok) {
        setUserDetails(prev => prev ? { ...prev, SecondaryEmail: email } : null);
      } else {
        throw new Error("Failed to update email");
      }
    } catch (err) {
      throw err;
    }
  };

  const handleUpdateFaceVerification = (enabled: boolean) => {
    setUserDetails(prev => prev ? { ...prev, faceVerificationEnabled: enabled } : null);
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case "home":
        return <HomeTab userDetails={userDetails} todayLogs={todayLogs} monthlyStats={monthlyStats} onCreateAttendance={() => setCreateAttendanceOpen(true)} onCreateSiteVisit={() => setCreateSalesAttendanceOpen(true)} onSetTab={setActiveTab} userId={userId} scrollRef={swipeContainerRef} />;
      case "calendar":
        return <CalendarTab 
          currentMonth={currentMonth} 
          calendarDays={calendarDays} 
          usersMap={usersMap} 
          onEventClick={onEventClick} 
          onMeetingClick={(meeting) => { setSelectedMeeting(meeting); setMeetingDialogOpen(true); }}
          onCreateMeeting={() => setCreateMeetingOpen(true)}
          goToPrevMonth={goToPrevMonth} 
          goToNextMonth={goToNextMonth} 
          startHour={startHour}
          userDetails={userDetails}
        />;
      case "reports":
        return <ReportsTab monthlyStats={monthlyStats} allLogs={allVisibleAccounts} userId={userId} />;
      case "profile":
        return <ProfileTab userDetails={userDetails} userId={userId} isActive={activeTab === "profile"} onLogout={handleLogout} onFaceRegister={() => setFaceRegisterOpen(true)} onBiometricRegister={handleBiometricRegister} onUpdateSecondaryEmail={handleUpdateSecondaryEmail} onUpdateFaceVerification={handleUpdateFaceVerification} />;
      case "admin":
        return <AdminTab userId={userId} />;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-[#F9F6F4] overflow-hidden">
      <OfflineBanner isOnline={isOnline} isSyncing={isSyncing} pendingCount={pendingCount} />

      {/* Skeleton loader — only shown on very first load before any data */}
      {loading && posts.length === 0 && !error && (
        <div className="absolute inset-0 z-50 bg-[#F9F6F4] flex flex-col overflow-hidden pointer-events-none">
          {/* Header skeleton */}
          <div className="h-44 bg-[var(--brand-primary)] opacity-90 flex-shrink-0" />
          {/* Card skeleton */}
          <div className="mx-4 -mt-5 bg-white rounded-[22px] shadow-lg p-4 flex-shrink-0">
            <div className="flex justify-between items-center mb-3">
              <div className="h-3 w-24 bg-gray-100 rounded-full animate-pulse" />
              <div className="h-5 w-16 bg-gray-100 rounded-full animate-pulse" />
            </div>
            <div className="h-8 w-32 bg-gray-100 rounded-xl animate-pulse mb-2" />
            <div className="h-3 w-48 bg-gray-100 rounded-full animate-pulse" />
          </div>
          {/* Grid skeleton */}
          <div className="px-4 pt-6 grid grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-[18px] p-4 h-24 animate-pulse">
                <div className="w-9 h-9 rounded-[10px] bg-gray-100 mb-3" />
                <div className="h-3 w-20 bg-gray-100 rounded-full mb-1.5" />
                <div className="h-2.5 w-16 bg-gray-100 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-0 z-50 bg-white flex items-center justify-center p-6">
          <div className="bg-[#FEF0F0] border border-red-200 rounded-2xl px-4 py-3 text-sm text-[#CC1318] text-center">{error}</div>
        </div>
      )}

      {/* Tab content — CSS fade instead of framer-motion for better perf */}
      <div className="flex-1 overflow-hidden relative">
        <div key={activeTab} className="h-full animate-in fade-in duration-150">
          {renderActiveTab()}
        </div>
      </div>

      {/* Floating Today's Activity Panel */}
      {activeTab === "home" && (
        <>
          {isPanelOpen ? (
            <div className="absolute bottom-20 right-4 w-72 max-h-80 bg-white rounded-3xl border border-gray-100 shadow-2xl z-40 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
                <div>
                  <p className="font-semibold text-[13px] text-gray-800">Today's Activity</p>
                  <p className="text-[10px] text-gray-400">{todayVisits.length} record{todayVisits.length !== 1 ? "s" : ""}</p>
                </div>
                <button onClick={() => setIsPanelOpen(false)} className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 transition-colors"><X size={11} /></button>
              </div>
              <div className="overflow-y-auto flex-1 p-3">
                {timelineItems.length === 0 ? (
                  <p className="text-[11px] text-gray-400 text-center py-4">No activity today.</p>
                ) : (
                  timelineItems.map((item, i) => <TimelineItemComponent key={item.id} item={item} index={i} />)
                )}
              </div>
            </div>
          ) : (
            <button onClick={() => setIsPanelOpen(true)} className="absolute bottom-20 right-4 z-40 w-11 h-11 rounded-2xl bg-[#CC1318] flex items-center justify-center shadow-lg shadow-red-200 hover:bg-[#A8100F] transition-all active:scale-95">
              <MapPin size={18} className="text-white" />
              {todayVisits.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full border-2 border-[#CC1318] flex items-center justify-center text-[8px] font-bold text-[#CC1318]">{todayVisits.length}</span>
              )}
            </button>
          )}
        </>
      )}

      {/* Bottom Navigation — curved FAB cutout */}
      <div
        className="flex-shrink-0 relative"
        style={{ paddingBottom: "env(safe-area-inset-bottom,0px)" }}
      >
        {/* SVG curve that creates the mountain notch */}
        {activeTab === "home" && (userDetails?.Role === "SuperAdmin" || userDetails?.permissions?.canCreateAttendance || userDetails?.permissions?.canCreateSiteVisit) ? (
          <svg
            className="absolute -top-[50px] left-0 w-full pointer-events-none"
            height="60"
            viewBox="0 0 390 28"
            preserveAspectRatio="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M0 28 L140 28 Q165 28 172 14 Q180 0 195 0 Q210 0 218 14 Q225 28 250 28 L390 28 Z"
              fill="white"
            />
            {/* Top border line following the curve */}
            <path
              d="M0 28 L140 28 Q165 28 172 14 Q180 0 195 0 Q210 0 218 14 Q225 28 250 28 L390 28"
              fill="none"
              stroke="#f3f4f6"
              strokeWidth="1"
            />
          </svg>
        ) : (
          /* Flat top border when no FAB */
          <div className="absolute -top-px left-0 right-0 h-px bg-gray-100" />
        )}

        <div className="bg-white flex items-center">
          {NAV.map((item) => {
            const isActive = activeTab === item.id;
            const isMiddle = item.id === "home";
            // Show notification badge on profile tab
            const showBadge = item.id === "profile" && notifUnreadCount > 0;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id === "profile") markNotifsRead();
                  haptic("light");
                }}
                className={[
                  "flex-1 flex flex-col items-center gap-1 py-3 relative transition-all",
                  isMiddle && activeTab === "home" ? "pt-5" : "",
                ].join(" ")}
              >
                <div className="relative">
                  <item.icon
                    size={20}
                    className={isActive ? "text-[#CC1318]" : "text-gray-400"}
                    strokeWidth={isActive ? 2.5 : 1.8}
                  />
                  {showBadge && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#CC1318] rounded-full flex items-center justify-center text-[8px] font-bold text-white">
                      {notifUnreadCount > 9 ? "9+" : notifUnreadCount}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-semibold ${isActive ? "text-[#CC1318]" : "text-gray-400"}`}>
                  {item.label}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#CC1318]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Circular FAB — sits in the notch, above the nav */}
        {activeTab === "home" && (
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-10">
            {(userDetails?.Role === "SuperAdmin" || userDetails?.permissions?.canCreateAttendance || userDetails?.permissions?.canCreateSiteVisit) && (
              <button
                onClick={() => {
                  haptic("medium");
                  if (
                    userDetails?.Role === "SuperAdmin" ||
                    (userDetails?.permissions?.canCreateAttendance && userDetails?.permissions?.canCreateSiteVisit)
                  ) {
                    setCreateAttendanceOpen(true);
                  } else if (userDetails?.permissions?.canCreateAttendance) {
                    setCreateAttendanceOpen(true);
                  } else {
                    setCreateSalesAttendanceOpen(true);
                  }
                }}
                className="w-14 h-14 rounded-full bg-[#CC1318] flex items-center justify-center shadow-xl shadow-red-300 hover:bg-[#A8100F] active:scale-95 transition-all border-4 border-white"
              >
                <Plus size={22} className="text-white" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Swipe-to-refresh indicator ── */}
      {(pullDistance > 0 || isPullRefreshing) && (
        <div
          className="fixed top-0 left-0 right-0 z-[90] flex items-center justify-center pointer-events-none"
          style={{ paddingTop: `${Math.min(pullDistance, 60)}px`, transition: pullDistance === 0 ? "padding 0.3s ease" : "none" }}
        >
          <div className={`w-8 h-8 rounded-full bg-white shadow-lg border border-gray-100 flex items-center justify-center ${isPullRefreshing ? "animate-spin" : ""}`}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={isPullRefreshing ? "" : ""} style={{ transform: `rotate(${pullDistance * 3}deg)` }}>
              <path d="M8 2a6 6 0 1 0 6 6" stroke="#CC1318" strokeWidth="2" strokeLinecap="round"/>
              <path d="M14 2l-2 2 2 2" stroke="#CC1318" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
      )}

      {/* ── Session timeout warning modal ── */}
      {showSessionWarning && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm bg-white rounded-t-[32px] p-6 pb-10 shadow-2xl">
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-[14px] bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Clock size={20} className="text-amber-600" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-gray-900">Session Expiring Soon</p>
                <p className="text-[12px] text-gray-400 mt-0.5">You'll be logged out in {sessionSecondsLeft}s</p>
              </div>
            </div>
            <p className="text-[13px] text-gray-500 mb-5 leading-relaxed">
              Your session is about to expire. Stay logged in to continue using the app.
            </p>
            <div className="flex gap-3">
              <button
                onClick={dismissSessionWarning}
                className="flex-1 py-3.5 rounded-2xl border border-gray-200 text-[13px] font-semibold text-gray-500 hover:bg-gray-50 transition-all"
              >
                Dismiss
              </button>
              <button
                onClick={refreshSession}
                className="flex-1 py-3.5 rounded-2xl bg-[#CC1318] text-white text-[13px] font-bold hover:bg-[#A8100F] active:scale-95 transition-all"
              >
                Stay Logged In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <CreateAttendance
        open={createAttendanceOpen}
        onOpenChangeAction={setCreateAttendanceOpen}
        formData={formData}
        onChangeAction={onChangeAction}
        userDetails={{
          ReferenceID: userDetails?.ReferenceID ?? "",
          Email: userDetails?.Email ?? "",
          TSM: userDetails?.TSM ?? "",
          faceDescriptors: userDetails?.faceDescriptors,
          faceVerificationEnabled: userDetails?.faceVerificationEnabled
        } as any}
        fetchAccountAction={fetchAccountAction}
        setFormAction={setFormData}
      />
      <CreateSalesAttendance
        open={createSalesAttendanceOpen}
        onOpenChangeAction={setCreateSalesAttendanceOpen}
        formData={formData}
        onChangeAction={onChangeAction}
        userDetails={{
          ReferenceID: userDetails?.ReferenceID ?? "",
          Email: userDetails?.Email ?? "",
          TSM: userDetails?.TSM ?? "",
          Role: userDetails?.Role ?? "",
          faceDescriptors: userDetails?.faceDescriptors,
          faceVerificationEnabled: userDetails?.faceVerificationEnabled
        } as any}
        fetchAccountAction={fetchAccountAction}
        setFormAction={setFormData}
      />

      {/* ── Face Registration Dialog ── */}
      <Dialog open={faceRegisterOpen} onOpenChange={setFaceRegisterOpen}>
        <DialogContent className="p-0 rounded-[28px] max-w-sm w-full mx-auto overflow-hidden border-0 shadow-2xl max-h-[92vh] flex flex-col">
          <div className="bg-[var(--brand-primary)] px-6 pt-5 pb-6 flex-shrink-0">
            <div className="flex items-center gap-3 mb-2">
              <button
                onClick={() => setFaceRegisterOpen(false)}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
              >
                <X size={15} />
              </button>
              <div className="flex-1">
                <h2 className="text-white font-semibold text-base leading-tight">Face Registration</h2>
                <p className="text-white/65 text-[11px] mt-0.5">Biometric Setup</p>
              </div>
            </div>
          </div>
          <div className="p-5 bg-[#F9F6F4]">
            <p className="text-[13px] text-gray-600 mb-4 leading-relaxed">
              Please look at the camera and take 3 clear photos of your face from different angles to complete the registration.
            </p>
            <CameraLazy
              mode="register"
              onRegisterAction={handleFaceRegister}
              onCaptureAction={() => { }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <MeetingDetailsDialog open={meetingDialogOpen} onOpenChange={setMeetingDialogOpen} meeting={selectedMeeting} usersMap={usersMap} />
      <CreateMeetingDialog open={createMeetingOpen} onOpenChange={setCreateMeetingOpen} userDetails={userDetails} onSuccess={fetchMeetings} />
      <ActivityDialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setSelectedEvent(null); }} selectedEvent={selectedEvent} usersMap={usersMap} />
    </div>
  );
}

// ── Meeting Details Dialog ────────────────────────────────────────────────────

function MeetingDetailsDialog({ open, onOpenChange, meeting, usersMap }: { 
  open: boolean; onOpenChange: (open: boolean) => void; meeting: Meeting | null; usersMap: Record<string, UserInfo>;
}) {
  if (!meeting) return null;
  const user = usersMap[meeting.ReferenceID];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 rounded-[28px] max-w-sm w-full mx-auto overflow-hidden border-0 shadow-2xl">
        <div className="bg-purple-600 px-6 pt-8 pb-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4">
            <button
                onClick={() => onOpenChange(false)}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
              >
                <X size={15} />
              </button>
          </div>
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-4 border border-white/20">
              <Users size={32} className="text-white" />
            </div>
            <h2 className="text-white text-xl font-bold px-4">{meeting.Title}</h2>
            <div className="flex items-center gap-2 mt-2 bg-white/10 px-3 py-1 rounded-full border border-white/10">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-pulse" />
              <span className="text-white/80 text-[11px] font-bold uppercase tracking-wider">{meeting.Status}</span>
            </div>
          </div>
        </div>
        <div className="bg-white px-6 py-6 -mt-6 rounded-t-[32px] relative z-20">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0"><User size={18} className="text-purple-600" /></div>
              <div>
                <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest">Organizer</p>
                <p className="text-[14px] font-semibold text-gray-800">{user ? `${user.Firstname} ${user.Lastname}` : meeting.Email}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0"><CalendarIcon size={18} className="text-purple-600" /></div>
              <div>
                <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest">Schedule</p>
                <p className="text-[14px] font-semibold text-gray-800">
                  {new Date(meeting.StartDate).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}
                </p>
                <p className="text-[12px] text-gray-500">
                  {new Date(meeting.StartDate).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })} – {new Date(meeting.EndDate).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0"><Clock size={18} className="text-purple-600" /></div>
              <div>
                <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest">Duration</p>
                <p className="text-[14px] font-semibold text-gray-800">{meeting.Duration} minutes</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0"><MapPin size={18} className="text-purple-600" /></div>
              <div>
                <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest">Location</p>
                <p className="text-[14px] font-semibold text-gray-800">{meeting.Location || "Not specified"}</p>
              </div>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mb-2">Remarks</p>
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                <p className="text-[13px] text-gray-600 italic leading-relaxed">
                  {meeting.Remarks && meeting.Remarks !== "No remarks" ? `"${meeting.Remarks}"` : "No remarks added for this meeting."}
                </p>
              </div>
            </div>
          </div>
          <button onClick={() => onOpenChange(false)} className="w-full mt-8 py-4 bg-purple-600 text-white rounded-2xl font-bold text-[14px] shadow-lg shadow-purple-100 active:scale-95 transition-all">Close Details</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Meeting Dialog ─────────────────────────────────────────────────────

function CreateMeetingDialog({ open, onOpenChange, userDetails, onSuccess }: {
  open: boolean; onOpenChange: (open: boolean) => void; userDetails: UserDetails | null; onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    Title: "",
    StartDate: "",
    EndDate: "",
    Location: "",
    Remarks: ""
  });

  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (formData.StartDate && formData.EndDate) {
      const start = new Date(formData.StartDate);
      const end = new Date(formData.EndDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
        const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
        setDuration(diff);
      } else {
        setDuration(0);
      }
    }
  }, [formData.StartDate, formData.EndDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDetails) return;
    if (!formData.Title || !formData.StartDate || !formData.EndDate) {
      toast.error("Please fill in required fields");
      return;
    }

    if (new Date(formData.EndDate) <= new Date(formData.StartDate)) {
      toast.error("End date must be after start date");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/ModuleSales/Activity/Meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          ReferenceID: userDetails.ReferenceID,
          Email: userDetails.Email,
          TSM: userDetails.TSM
        })
      });

      if (res.ok) {
        toast.success("Meeting created successfully");
        onSuccess();
        onOpenChange(false);
        setFormData({ Title: "", StartDate: "", EndDate: "", Location: "", Remarks: "" });
      } else {
        const error = await res.json();
        toast.error(error.error || "Failed to create meeting");
      }
    } catch (e) {
      toast.error("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 rounded-[28px] max-w-sm w-full mx-auto overflow-hidden border-0 shadow-2xl">
        <div className="bg-purple-600 px-6 pt-5 pb-6">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => onOpenChange(false)} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"><X size={15} /></button>
            <div className="flex-1">
              <h2 className="text-white font-semibold text-base leading-tight">Create Meeting</h2>
              <p className="text-white/65 text-[11px] mt-0.5">Schedule a new activity</p>
            </div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="p-6 bg-white flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest ml-1">Meeting Title</label>
            <input 
              required
              value={formData.Title}
              onChange={e => setFormData(prev => ({ ...prev, Title: e.target.value }))}
              placeholder="Project Sync / Client Presentation" 
              className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-[13px] outline-none focus:border-purple-300 transition-all" 
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest ml-1">Start Date</label>
              <input 
                required
                type="datetime-local"
                value={formData.StartDate}
                onChange={e => setFormData(prev => ({ ...prev, StartDate: e.target.value }))}
                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3 text-[12px] outline-none focus:border-purple-300 transition-all" 
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest ml-1">End Date</label>
              <input 
                required
                type="datetime-local"
                value={formData.EndDate}
                onChange={e => setFormData(prev => ({ ...prev, EndDate: e.target.value }))}
                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3 text-[12px] outline-none focus:border-purple-300 transition-all" 
              />
            </div>
          </div>

          {duration > 0 && (
            <div className="bg-purple-50 rounded-xl px-4 py-2 flex items-center justify-between border border-purple-100">
              <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider">Auto Duration</span>
              <span className="text-[13px] font-bold text-purple-700">{duration} minutes</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest ml-1">Location</label>
            <div className="relative">
              <MapPin size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                value={formData.Location}
                onChange={e => setFormData(prev => ({ ...prev, Location: e.target.value }))}
                placeholder="Office / Zoom / Client Site" 
                className="w-full rounded-2xl border border-gray-100 bg-gray-50 pl-10 pr-4 py-3 text-[13px] outline-none focus:border-purple-300 transition-all" 
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest ml-1">Remarks</label>
            <textarea 
              value={formData.Remarks}
              onChange={e => setFormData(prev => ({ ...prev, Remarks: e.target.value }))}
              placeholder="Add any additional notes here..." 
              rows={3}
              className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-[13px] outline-none focus:border-purple-300 transition-all resize-none" 
            />
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-4 bg-purple-600 text-white rounded-2xl font-bold text-[14px] shadow-lg shadow-purple-100 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? "Creating..." : "Schedule Meeting"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Page() {
  return (
    <ProtectedPageWrapper>
      <UserProvider>
        <FormatProvider>
          <ActivityPage />
        </FormatProvider>
      </UserProvider>
    </ProtectedPageWrapper>
  );
}