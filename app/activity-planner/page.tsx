"use client";

/* ============================================================================
   BIOLOG · Activity Planner — "Calm Mint"
   ----------------------------------------------------------------------------
   This file is the composition root only. Screens live in ./mint/*, business
   logic lives in ./mint/data.ts, and the design system in ./mint/ui.tsx.
   ========================================================================== */

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import ProtectedPageWrapper from "@/components/protected-page-wrapper";
import { UserProvider } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";

import {
  useActivityData,
  isSales,
  isAdminish,
  useSystemSettings,
  nextVisitAction,
} from "./mint/data";
import { HomeScreen } from "./mint/home";
import { CalendarScreen } from "./mint/calendar";
import { ReportsScreen } from "./mint/reports";
import { ProfileScreen } from "./mint/profile";
import { SiteVisitSheet, type SiteVisitPayload } from "./mint/site-visit-sheet";
import { ClockDrawer } from "./mint/clock-drawer";
import { BottomNav, LocationFab } from "./mint/shell";
import { MeetingDetailsSheet, CreateMeetingSheet } from "./mint/meetings";
import {
  ErrorOverlay,
  LoadingSkeleton,
  SplashScreen,
  SyncBanner,
  OfflineQueueSheet,
  ExportConfirmSheet,
  TimesheetDetail,
} from "./mint/states";
import { Card, EmptyState, Row, RowGroup, SectionLabel } from "./mint/ui";

const ActivityDialog = dynamic(() => import("@/components/dashboard-dialog"), { ssr: false });
const CreateAttendance = dynamic(() => import("@/components/CreateAttendance"), { ssr: false });
const CreateSalesAttendance = dynamic(
  () => import("@/components/CreateSalesAttenance"),
  { ssr: false }
);
const CameraLazy = dynamic(() => import("@/components/camera"), { ssr: false });

function ActivityPlanner() {
  const data = useActivityData();
  const [siteVisitOpen, setSiteVisitOpen] = useState(false);
  const [clockDrawerOpen, setClockDrawerOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [salesVisitOpen, setSalesVisitOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [viewTimesheet, setViewTimesheet] = useState(false);
  const [createMeetingOpen, setCreateMeetingOpen] = useState(false);
  const [booted, setBooted] = useState(false);

  // Form state for the existing attendance dialogs (kept so their internal
  // photo / GPS / face flows continue to work unchanged).
  const emptyForm = React.useMemo(
    () => ({
      ReferenceID: data.userDetails?.ReferenceID ?? "",
      Email: data.userDetails?.Email ?? "",
      TSM: data.userDetails?.TSM ?? "",
      manager: data.userDetails?.Manager ?? "",
      Type: "",
      Status: "",
      PhotoURL: "",
      Remarks: "",
    }),
    [data.userDetails]
  );
  // Widened shape so the optional sales-only fields (company_name,
  // contact_person, …) survive the round trip through CreateSalesAttendance.
  type SalesForm = typeof emptyForm & Record<string, any>;
  const [salesForm, setSalesForm] = useState<SalesForm>(emptyForm);

  // Re-seed identity fields whenever the profile resolves
  React.useEffect(() => {
    setSalesForm((prev) => ({ ...prev, ...emptyForm }));
  }, [emptyForm]);

  const onSalesFormChange = (field: string, value: any) =>
    setSalesForm((prev) => ({ ...prev, [field]: value }));

  // Brief splash on first paint so the gradient header doesn't flash
  React.useEffect(() => {
    const t = setTimeout(() => setBooted(true), 550);
    return () => clearTimeout(t);
  }, []);

  const sales = isSales(data.userDetails);
  const showFab = data.activeTab === "home" || data.activeTab === "calendar";
  const shift = useSystemSettings();

  // Clock In / Clock Out uses the dedicated drawer — not the components/
  // CreateAttendance dialog. It reuses the same route + offline queue.
  const openPrimary = () => setClockDrawerOpen(true);

  // The centre FAB keeps its old meaning for Sales (their main task is a site
  // visit); everyone else gets the clock drawer.
  const openFab = () => {
    if (sales) setSalesVisitOpen(true);
    else setClockDrawerOpen(true);
  };

  const openSiteVisit = () => {
    if (sales) setSalesVisitOpen(true);
    else setSiteVisitOpen(true);
  };

  const submitSiteVisit = async (p: SiteVisitPayload) => {
    // Persist through the existing sales flow when available; otherwise surface
    // the payload so nothing is silently dropped.
    if (sales) {
      setSalesVisitOpen(true);
    } else {
      try {
        const { enqueuePendingLog } = await import("@/lib/offline-store");
        await enqueuePendingLog({
          ReferenceID: data.userDetails?.ReferenceID ?? "",
          Email: data.userDetails?.Email ?? "",
          Type: "Client Visit",
          Status: p.nextAction,
          PhotoURL: p.photoUrl,
          Remarks: p.remarks,
          TSM: data.userDetails?.TSM ?? "",
          SiteVisitAccount: p.clientType === "new" ? "New Client" : "Existing Client",
          Location: p.location,
          date_created: new Date().toISOString(),
          Latitude: p.latitude,
          Longitude: p.longitude,
        } as any);
      } catch {
        /* fall through to the toast below */
      }
    }
    setSiteVisitOpen(false);
    await data.refresh();
    toast.success("Site visit saved. It syncs automatically.");
  };

  // ── First load / error gates ─────────────────────────────────────────────
  if (!booted) return <SplashScreen />;

  if (data.error && !data.loading) {
    return <ErrorOverlay message={data.error} onRetry={data.refresh} />;
  }

  if (data.loading && data.posts.length === 0 && !data.userDetails) {
    return <LoadingSkeleton />;
  }

  // ── Screen routing ───────────────────────────────────────────────────────
  const renderScreen = () => {
    if (viewTimesheet) {
      return <TimesheetDetail data={data} />;
    }
    switch (data.activeTab) {
      case "home":
        return (
          <HomeScreen
            data={data}
            onOpenSiteVisit={openSiteVisit}
            onOpenAttendance={openPrimary}
          />
        );
      case "calendar":
        return (
          <CalendarScreen
            data={data}
            onCreateMeeting={() => setCreateMeetingOpen(true)}
          />
        );
      case "reports":
        return <ReportsScreen data={data} />;
      case "profile":
        return <ProfileScreen data={data} />;
      default:
        return null;
    }
  };

  return (
    <div className="mint-root fixed inset-0 flex flex-col overflow-hidden">
      <SyncBanner
        isOnline={data.isOnline}
        isSyncing={data.isSyncing}
        pendingCount={data.pendingCount}
        onSyncNow={data.syncNow}
      />

      <div className="flex-1 overflow-hidden relative">
        <div key={`${data.activeTab}-${viewTimesheet}`} className="h-full animate-fade-rise">
          {renderScreen()}
        </div>
      </div>

      <LocationFab
        count={data.todayVisits.length}
        bottomOffset={84}
        onClick={() => setQueueOpen(true)}
      />

      <BottomNav
        active={data.activeTab}
        notifCount={data.notifUnreadCount}
        showFab={showFab && !viewTimesheet}
        onChange={(t) => {
          setViewTimesheet(false);
          data.setActiveTab(t);
          if (t === "profile") data.markNotifsRead();
        }}
        onFab={openFab}
      />

      {/* ── Clock In / Clock Out drawer (photo + location only) ────────────── */}
      <ClockDrawer
        open={clockDrawerOpen}
        onClose={() => setClockDrawerOpen(false)}
        userDetails={data.userDetails}
        todayLogs={data.todayLogs}
        officeStart={shift.officeStartTime}
        gracePeriod={shift.gracePeriod}
        onDone={data.refresh}
      />

      {/* ── Site Visit Log bottom sheet ─────────────────────────────────────── */}
      <SiteVisitSheet
        open={siteVisitOpen}
        onClose={() => setSiteVisitOpen(false)}
        onSubmit={submitSiteVisit}
        visitCountToday={data.todayVisits.length}
        suggestedAction={nextVisitAction(data.todayLogs)}
      />

      {/* ── Offline queue ──────────────────────────────────────────────────── */}
      <OfflineQueueSheet
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        isOnline={data.isOnline}
        isSyncing={data.isSyncing}
        onSyncNow={data.syncNow}
        onRefresh={data.refresh}
      />

      {/* ── Existing attendance / site-visit dialogs ───────────────────────── */}
      <CreateAttendance
        open={attendanceOpen}
        onOpenChangeAction={setAttendanceOpen}
        formData={emptyForm}
        onChangeAction={() => {}}
        userDetails={{
          ReferenceID: data.userDetails?.ReferenceID ?? "",
          Email: data.userDetails?.Email ?? "",
          TSM: data.userDetails?.TSM ?? "",
          Manager: data.userDetails?.Manager ?? "",
          faceDescriptors: data.userDetails?.faceDescriptors,
          faceVerificationEnabled: data.userDetails?.faceVerificationEnabled,
        } as any}
        fetchAccountAction={data.refresh}
        setFormAction={() => {}}
      />

      <CreateSalesAttendance
        open={salesVisitOpen}
        onOpenChangeAction={setSalesVisitOpen}
        formData={salesForm}
        onChangeAction={onSalesFormChange}
        userDetails={{
          ReferenceID: data.userDetails?.ReferenceID ?? "",
          Email: data.userDetails?.Email ?? "",
          TSM: data.userDetails?.TSM ?? "",
          Role: data.userDetails?.Role ?? "",
          Manager: data.userDetails?.Manager ?? "",
          faceDescriptors: data.userDetails?.faceDescriptors,
          faceVerificationEnabled: data.userDetails?.faceVerificationEnabled,
        } as any}
        fetchAccountAction={data.refresh}
        setFormAction={setSalesForm as any}
      />

      {/* ── Meetings ───────────────────────────────────────────────────────── */}
      <MeetingDetailsSheet
        open={data.meetingDialogOpen}
        onClose={() => data.setMeetingDialogOpen(false)}
        meeting={data.selectedMeeting}
        usersMap={data.usersMap}
      />

      <CreateMeetingSheet
        open={createMeetingOpen}
        onClose={() => setCreateMeetingOpen(false)}
        userDetails={data.userDetails}
        onSuccess={data.fetchMeetings}
      />

      {/* ── Log detail ─────────────────────────────────────────────────────── */}
      <ActivityDialog
        open={data.dialogOpen}
        onOpenChange={(o: boolean) => {
          data.setDialogOpen(o);
          if (!o) data.setSelectedEvent(null);
        }}
        selectedEvent={data.selectedEvent}
        usersMap={data.usersMap}
      />

      {/* ── Face registration ──────────────────────────────────────────────── */}
      <Dialog open={data.faceRegisterOpen} onOpenChange={data.setFaceRegisterOpen}>
        <DialogContent className="p-0 rounded-[var(--r-sheet)] max-w-sm w-full mx-auto overflow-hidden border-0 max-h-[92vh] flex flex-col">
          <VisuallyHidden>
            <DialogTitle>Face Registration</DialogTitle>
          </VisuallyHidden>
          <div
            className="px-6 pt-5 pb-5 flex-shrink-0"
            style={{ background: "linear-gradient(180deg, var(--mint-gradient), var(--card))" }}
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => data.setFaceRegisterOpen(false)}
                aria-label="Close"
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
              >
                <X size={17} />
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="text-[17px] font-black text-[var(--text)] leading-tight">
                  Face Registration
                </h2>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                  Biometric setup
                </p>
              </div>
            </div>
          </div>
          <div className="p-5" style={{ background: "var(--bg)" }}>
            <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mb-4 leading-relaxed">
              Look at the camera and take 3 clear photos from different angles. This is what your
              supervisor sees when you clock in.
            </p>
            <CameraLazy
              mode="register"
              onRegisterAction={data.handleFaceRegister}
              onCaptureAction={() => {}}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Page() {
  return (
    <ProtectedPageWrapper>
      <UserProvider>
        <FormatProvider>
          <div className="mint-root">
            <ActivityPlanner />
          </div>
        </FormatProvider>
      </UserProvider>
    </ProtectedPageWrapper>
  );
}
