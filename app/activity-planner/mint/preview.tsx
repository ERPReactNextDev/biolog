"use client";

/* TEMP verification harness for the Calm Mint screens. Removed after use. */

import React, { useMemo, useState } from "react";
import { HomeScreen } from "./home";
import { CalendarScreen } from "./calendar";
import { ReportsScreen } from "./reports";
import { ProfileScreen } from "./profile";
import { SiteVisitSheet } from "./site-visit-sheet";
import { BottomNav, LocationFab } from "./shell";
import CreateSalesAttendance from "@/components/CreateSalesAttenance";
import {
  generateCalendarDays,
  toDateKey,
  type ActivityData,
  type ActivityLog,
  type Meeting,
  type UserDetails,
  type UserInfo,
} from "./data";

const USER: UserDetails = {
  UserId: "83",
  Firstname: "Leroux",
  Lastname: "Sieghart V. Xchire",
  Email: "leroux.xchire@biolog.ph",
  Role: "Territory Sales Associate",
  Department: "Sales",
  ReferenceID: "BIO-2026-0143",
  TSM: "3",
  Manager: "R. Dela Cruz",
  faceVerificationEnabled: true,
  credentials: [{ id: "x" }],
  faceDescriptors: [[0.1]],
};

const base = (iso: string, over: Partial<ActivityLog> = {}): ActivityLog => ({
  ReferenceID: USER.ReferenceID,
  Email: USER.Email,
  Type: "On Field",
  Status: "Login",
  Location: "Headquarters · Quezon City",
  date_created: iso,
  Remarks: "",
  TSM: "3",
  SiteVisitAccount: "",
  _id: iso,
  ...over,
});

const LOGS: ActivityLog[] = [
  base("2026-10-01T08:02:00+08:00", { _id: "l1" }),
  base("2026-10-01T10:30:00+08:00", {
    _id: "l2",
    Type: "Client Visit",
    SiteVisitAccount: "People Power Monument, EDSA",
    Location:
      "People Power Monument, EDSA, Camp Aguinaldo, 3rd District, Quezon City, Eastern Manila District, Metro Manila, 1116, Philippines",
  }),
  base("2026-10-01T12:15:00+08:00", { _id: "l3", Status: "Logout" }),
  base("2026-10-01T14:00:00+08:00", { _id: "l3b", Type: "On Field" }),
];

const MEETINGS: Meeting[] = [
  {
    _id: "m1",
    ReferenceID: USER.ReferenceID,
    Email: USER.Email,
    Title: "Weekly Territory Sync",
    StartDate: "2026-10-01T14:00:00+08:00",
    EndDate: "2026-10-01T15:00:00+08:00",
    Duration: 60,
    Location: "ZOOM",
    Remarks: "Review NCR pipeline",
    TSM: "3",
    Status: "Scheduled",
    CreatedAt: "2026-09-28T10:00:00+08:00",
    Manager: "R. Dela Cruz",
    CompanyName: "Biolog PH",
  },
];

const USERS: Record<string, UserInfo> = {
  [USER.ReferenceID]: {
    Firstname: "Leroux",
    Lastname: "Sieghart V. Xchire",
    TSM: "3",
    Directories: ["Sales"],
  },
};

export function MintPreview() {
  const [tab, setTab] = useState<any>("home");
  const [sheet, setSheet] = useState(false);
  const [salesDrawer, setSalesDrawer] = useState(false);
  const [form, setForm] = useState<any>({
    ReferenceID: USER.ReferenceID,
    Email: USER.Email,
    TSM: USER.TSM,
    Role: USER.Role,
    manager: USER.Manager ?? "",
    Type: "On Field",
    Status: "Logout",
    PhotoURL: "",
    Remarks: "",
  });

  const month = useMemo(() => new Date(2026, 9, 1), []);
  const days = useMemo(() => generateCalendarDays(2026, 9), []);
  const today = new Date(2026, 9, 1);
  const todayKey = toDateKey(today);

  const grouped: Record<string, (ActivityLog | Meeting)[]> = {};
  LOGS.forEach((l) => {
    const k = toDateKey(new Date(l.date_created));
    (grouped[k] ||= []).push(l);
  });
  MEETINGS.forEach((m) => {
    const k = toDateKey(new Date(m.StartDate));
    (grouped[k] ||= []).push(m);
  });

  const data = {
    userId: "83",
    userDetails: USER,
    usersMap: USERS,
    posts: LOGS,
    meetings: MEETINGS,
    loading: false,
    error: null,
    allVisibleAccounts: LOGS,
    allVisibleMeetings: MEETINGS,
    groupedByDate: grouped,
    currentMonth: month,
    setCurrentMonth: () => {},
    calendarDays: days,
    today,
    todayKey,
    todayLogs: (grouped[todayKey] ?? []).filter((i) => "date_created" in i) as ActivityLog[],
    todayVisits: grouped[todayKey] ?? [],
    timelineItems: [],
    goToPrevMonth: () => {},
    goToNextMonth: () => {},
    monthlyStats: { present: 2, absent: 20, visits: 2, total: 22 },
    isClockedIn: false,
    isLate: false,
    pendingCount: 0,
    isOnline: true,
    isSyncing: false,
    syncNow: () => {},
    notifUnreadCount: 3,
    markNotifsRead: () => {},
    activeTab: tab,
    setActiveTab: setTab,
    selectedEvent: null,
    setSelectedEvent: () => {},
    dialogOpen: false,
    setDialogOpen: () => {},
    selectedMeeting: null,
    meetingDialogOpen: false,
    setMeetingDialogOpen: () => {},
    createMeetingOpen: false,
    setCreateMeetingOpen: () => {},
    faceRegisterOpen: false,
    setFaceRegisterOpen: () => {},
    biometricRegistering: false,
    swipeContainerRef: { current: null },
    pullDistance: 0,
    isPullRefreshing: false,
    refresh: () => {},
    fetchMeetings: () => {},
    handleLogout: () => {},
    handleFaceRegister: () => {},
    handleBiometricRegister: () => {},
    handleUpdateSecondaryEmail: async () => {},
    handleUpdateFaceVerification: () => {},
    onEventClick: () => {},
    onMeetingClick: () => {},
  } as unknown as ActivityData;

  return (
    <div className="mint-root fixed inset-0 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden relative">
        {tab === "home" && (
          <HomeScreen
            data={data}
            onOpenSiteVisit={() => setSalesDrawer(true)}
            onOpenAttendance={() => setSalesDrawer(true)}
          />
        )}
        {tab === "calendar" && (
          <CalendarScreen data={data} onCreateMeeting={() => setSheet(true)} />
        )}
        {tab === "reports" && <ReportsScreen data={data} />}
        {tab === "profile" && <ProfileScreen data={data} />}
      </div>

      <LocationFab count={4} bottomOffset={84} onClick={() => setSalesDrawer(true)} />

      <BottomNav
        active={tab}
        notifCount={3}
        showFab
        onChange={setTab}
        onFab={() => setSalesDrawer(true)}
      />

      <SiteVisitSheet
        open={sheet}
        onClose={() => setSheet(false)}
        onSubmit={() => setSheet(false)}
        visitCountToday={4}
      />

      {/* The real Sales drawer, so we can verify its geometry */}
      <CreateSalesAttendance
        open={salesDrawer}
        onOpenChangeAction={setSalesDrawer}
        formData={form}
        onChangeAction={(f, v) => setForm((p: any) => ({ ...p, [f]: v }))}
        userDetails={{
          ReferenceID: USER.ReferenceID,
          Email: USER.Email,
          TSM: USER.TSM,
          Role: USER.Role,
          Manager: USER.Manager ?? "",
        } as any}
        fetchAccountAction={() => {}}
        setFormAction={setForm as any}
      />
    </div>
  );
}
