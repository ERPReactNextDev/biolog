"use client";

/* ============================================================================
   BIOLOG · "Calm Mint" — data layer
   ----------------------------------------------------------------------------
   All real app logic (Supabase/API fetches, offline queue, notifications,
   auth resolution) lives here. The screens are presentational only, so the UI
   can be re-skinned without touching business rules.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useUser } from "@/contexts/UserContext";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useNotifications } from "@/hooks/useNotifications";
import { useSwipeToRefresh } from "@/hooks/useSwipeToRefresh";
import { usePreferences } from "@/lib/preferences";
import { haptic } from "@/lib/haptics";
import { playNotificationSound } from "@/lib/notification-sound";
import {
  toDateKeyPH,
  getPHHour,
  formatPHTimeStr,
  setPHTime,
  phTodayAsLocalDate,
} from "@/lib/ph-time";
import type { DateRange } from "react-day-picker";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ActivityLog {
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
  Latitude?: number | null;
  Longitude?: number | null;
}

export interface Meeting {
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
  Manager?: string;
  CompanyName?: string;
  Latitude?: number | null;
  Longitude?: number | null;
}

export interface UserInfo {
  Firstname: string;
  Lastname: string;
  profilePicture?: string;
  TSM: string;
  Directories: string[];
}

export interface UserDetails {
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
  Manager?: string;
  Directories?: string[];
  faceVerificationEnabled?: boolean;
}

export type MonthlyStats = {
  present: number;
  absent: number;
  visits: number;
  total: number;
};

export type TimelineItem = {
  id: string;
  title?: string | null;
  description: string;
  location: string;
  status: string;
  /**
   * Needed to tell a shift Clock In from a site-visit Time In — Status alone
   * is "Login" for both, so without this the label is a coin flip.
   */
  type?: string | null;
  date?: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type ActiveTab = "home" | "calendar" | "reports" | "profile" | "admin";

// ── Date helpers ─────────────────────────────────────────────────────────────

export const toDateKey = (date: Date | string) => toDateKeyPH(date);

export function generateCalendarDays(year: number, month: number): Date[] {
  const days: Date[] = [];
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const firstWeekday = firstDayOfMonth.getDay();
  // Leading days from the previous month so the grid starts on Monday.
  for (let i = firstWeekday - 1; i >= 0; i--)
    days.push(new Date(year, month, 1 - i - 1));
  for (let day = 1; day <= lastDayOfMonth.getDate(); day++)
    days.push(new Date(year, month, day));
  while (days.length % 7 !== 0) {
    days.push(
      new Date(year, month, lastDayOfMonth.getDate() + (days.length - firstWeekday) + 1)
    );
  }
  return days;
}

export function isSameDay(d1: Date, d2: Date) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function timeAgoLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Clock In/Out vs Site Visit: Time In/Time Out ─────────────────────────────
   Both flows write the SAME Status values ("Login" / "Logout"). The only thing
   that separates them is Type:

     Clock In  →  Type: "On Field"      Status: "Login"
     Time In   →  Type: "Client Visit"  Status: "Login"
     Time Out  →  Type: "Client Visit"  Status: "Logout"
     Clock Out →  Type: "On Field"      Status: "Logout"

   So the real daily sequence is:  Clock In → Time In → Time Out → Clock Out,
   and any attendance state MUST ignore client-visit rows. Reading them as one
   sequence is what makes the button flip to "Clock Out" after a site visit.
   ------------------------------------------------------------------------- */

export const CLIENT_VISIT_TYPE = "Client Visit";

/** True for shift (attendance) rows, excluding site-visit Time In/Time Out. */
export function isShiftLog(log: { Type?: string | null }): boolean {
  return (log.Type || "").trim().toLowerCase() !== CLIENT_VISIT_TYPE.toLowerCase();
}

export function shiftLogs(logs: ActivityLog[]): ActivityLog[] {
  return logs.filter(isShiftLog);
}

/** Has the agent started their shift today? (Clock In) */
export function hasClockedIn(logs: ActivityLog[]): boolean {
  return shiftLogs(logs).some((l) => l.Status === "Login");
}

/** Has the agent ended their shift today? (Clock Out) */
export function hasClockedOut(logs: ActivityLog[]): boolean {
  return shiftLogs(logs).some((l) => l.Status === "Logout");
}

/** On duty = clocked in and not yet clocked out. */
export function isOnDuty(logs: ActivityLog[]): boolean {
  return hasClockedIn(logs) && !hasClockedOut(logs);
}

/** The next attendance action, given today's logs. */
export function nextClockAction(logs: ActivityLog[]): "Login" | "Logout" {
  return isOnDuty(logs) ? "Logout" : "Login";
}

/* ── Site-visit sequence (Time In / Time Out) ─────────────────────────────────
   Deliberately independent of Clock In / Clock Out. A field agent can be on
   duty with no open visit, or at a client with no shift log at all, so the
   two sequences must never read each other's state. */

export function isVisitLog(log: { Type?: string | null }): boolean {
  return (log.Type || "").trim().toLowerCase() === CLIENT_VISIT_TYPE.toLowerCase();
}

export function visitLogs(logs: ActivityLog[]): ActivityLog[] {
  return logs.filter(isVisitLog);
}

/**
 * Visits repeat per client, so "open" means the most recent visit row is a
 * Time In with no Time Out after it — not simply "any Login exists".
 */
export function isOnVisit(logs: ActivityLog[]): boolean {
  const last = [...visitLogs(logs)].sort(
    (a, b) => new Date(a.date_created).getTime() - new Date(b.date_created).getTime()
  ).pop();
  return last?.Status === "Login";
}

/** Next site-visit action, scoped to client-visit rows only. */
export function nextVisitAction(logs: ActivityLog[]): "Login" | "Logout" {
  return isOnVisit(logs) ? "Logout" : "Login";
}

/**
 * The one place that decides how a log row is worded.
 * Type picks the noun (Clock for the shift, Time for a client visit);
 * Status picks the direction (In vs Out).
 *
 *   On Field     + Login  -> Clock In
 *   On Field     + Logout -> Clock Out
 *   Client Visit + Login  -> Time In
 *   Client Visit + Logout -> Time Out
 */
export function logActionLabel(
  type: string | null | undefined,
  status: string | null | undefined
): string {
  const visit = (type || "").trim().toLowerCase() === CLIENT_VISIT_TYPE.toLowerCase();
  const into = (status || "").trim().toLowerCase() === "login";
  if (visit) return into ? "Time In" : "Time Out";
  return into ? "Clock In" : "Clock Out";
}

/** The On Field Login timestamp, used for lateness. */
export function firstClockIn(logs: ActivityLog[]): ActivityLog | undefined {
  return shiftLogs(logs)
    .filter((l) => l.Status === "Login")
    .sort(
      (a, b) =>
        new Date(a.date_created).getTime() - new Date(b.date_created).getTime()
    )[0];
}

// ── System settings (shift, grace period, announcement) ──────────────────────

export type SystemSettings = {
  officeStartTime: string;
  officeEndTime: string;
  gracePeriod: number;
  themeColor: string;
  logoUrl: string;
  announcement: string;
};

export function useSystemSettings() {
  const [settings, setSettings] = useState<SystemSettings>({
    officeStartTime: "08:00",
    officeEndTime: "17:00",
    gracePeriod: 15,
    themeColor: "mint",
    logoUrl: "",
    announcement: "",
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data && data.type === "global") {
          setSettings({
            officeStartTime: data.officeStartTime || "08:00",
            officeEndTime: data.officeEndTime || "17:00",
            gracePeriod: data.gracePeriod || 15,
            themeColor: data.themeColor || "mint",
            logoUrl: data.logoUrl || "",
            announcement: data.announcement || "",
          });
        }
      })
      .catch(() => {
        /* keep defaults — field device may be offline */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return settings;
}

// ── Reverse geocoding (shared by timeline + detail views) ────────────────────

const addressCache = new Map<string, string>();

export function isCoordinateFormat(location: string): boolean {
  if (!location) return false;
  return /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(location.trim());
}

async function reverseGeocode(coords: string): Promise<string | null> {
  if (addressCache.has(coords)) return addressCache.get(coords)!;
  try {
    const [lat, lon] = coords.split(",").map((s) => parseFloat(s.trim()));
    if (isNaN(lat) || isNaN(lon)) return null;
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
      { headers: { "Accept-Language": "en" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const address = data.display_name || null;
    if (address) addressCache.set(coords, address);
    return address;
  } catch {
    return null;
  }
}

export function useResolvedLocation(
  location: string | undefined | null,
  latitude?: number | null,
  longitude?: number | null
) {
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const coordString = useMemo(() => {
    const latNum = typeof latitude === "string" ? parseFloat(latitude) : latitude;
    const lngNum = typeof longitude === "string" ? parseFloat(longitude) : longitude;
    if (
      latNum != null &&
      lngNum != null &&
      !isNaN(latNum) &&
      !isNaN(lngNum)
    ) {
      return `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
    }
    return location;
  }, [location, latitude, longitude]);

  useEffect(() => {
    if (!coordString || !isCoordinateFormat(coordString)) {
      setResolvedAddress(null);
      return;
    }
    if (addressCache.has(coordString)) {
      setResolvedAddress(addressCache.get(coordString)!);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine) {
      setIsResolving(true);
      reverseGeocode(coordString)
        .then((a) => a && setResolvedAddress(a))
        .finally(() => setIsResolving(false));
    }
  }, [coordString]);

  return {
    displayLocation: resolvedAddress || location || "Not specified",
    isResolving,
    isCoords: isCoordinateFormat(coordString || ""),
    originalCoords: coordString,
  };
}

// ── Live clock (Philippine time) ─────────────────────────────────────────────

export function useLiveClock(): string {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(formatPHTimeStr(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// ── Main data hook ───────────────────────────────────────────────────────────

export function useActivityData() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { userId, setUserId } = useUser();

  // ── Resolve the active user id: ?id -> localStorage -> offline session ────
  const [resolvedQueryUserId, setResolvedQueryUserId] = useState<string | null>(null);
  useEffect(() => {
    const idParam = searchParams?.get("id") ?? "";
    if (idParam) {
      setResolvedQueryUserId(idParam);
      return;
    }
    const localId = localStorage.getItem("userId");
    if (localId) {
      setResolvedQueryUserId(localId);
      return;
    }
    (async () => {
      const { getOfflineSession } = await import("@/lib/offline-auth");
      const offlineId = await getOfflineSession();
      if (offlineId) {
        localStorage.setItem("userId", offlineId);
        setResolvedQueryUserId(offlineId);
        return;
      }
      setResolvedQueryUserId("");
    })();
  }, [searchParams]);

  const queryUserId = resolvedQueryUserId;

  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [posts, setPosts] = useState<ActivityLog[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, UserInfo>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateCreatedFilterRange] = useState<DateRange | undefined>(undefined);
  const [currentMonth, setCurrentMonth] = useState(phTodayAsLocalDate());
  const [activeTab, setActiveTab] = useState<ActiveTab>("home");
  const [selectedEvent, setSelectedEvent] = useState<ActivityLog | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [meetingDialogOpen, setMeetingDialogOpen] = useState(false);
  const [faceRegisterOpen, setFaceRegisterOpen] = useState(false);
  const [biometricRegistering, setBiometricRegistering] = useState(false);

  const today = phTodayAsLocalDate();

  // ── Logout ────────────────────────────────────────────────────────────────
  const handleLogout = useCallback(async () => {
    try {
      const { clearOfflineSession } = await import("@/lib/offline-auth");
      await clearOfflineSession();
    } catch {
      /* silent */
    }
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      /* offline — local session is already cleared */
    }
    localStorage.removeItem("userId");
    router.replace("/Login");
  }, [router]);

  useEffect(() => {
    if (queryUserId && queryUserId !== userId) setUserId(queryUserId);
  }, [queryUserId, userId, setUserId]);

  // ── Profile: stale-while-revalidate so the shell paints instantly ─────────
  useEffect(() => {
    if (queryUserId === null) return;
    if (!queryUserId) {
      setError("User ID is missing.");
      setLoading(false);
      setTimeout(() => router.replace("/Login"), 1500);
      return;
    }

    const applyData = (d: any) => {
      setUserDetails({
        UserId: d._id ?? "",
        Firstname: d.Firstname ?? "",
        Lastname: d.Lastname ?? "",
        Email: d.Email ?? "",
        Role: d.Role ?? "",
        Department: d.Department ?? "",
        Company: d.Company ?? "",
        ReferenceID: d.ReferenceID ?? "",
        profilePicture: d.profilePicture ?? "",
        faceDescriptors: d.faceDescriptors ?? null,
        credentials: d.credentials ?? [],
        twoFactorEnabled: d.twoFactorEnabled ?? false,
        SecondaryEmail: d.SecondaryEmail ?? "",
        pin: d.pin ?? "",
        TSM: d.TSM ?? "",
        Manager: d.Manager ?? "",
        Directories: d.Directories ?? [],
        faceVerificationEnabled: d.faceVerificationEnabled ?? true,
      });
      setError(null);
    };

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const { getCachedUser, cacheUser } = await import("@/lib/offline-auth");
        const cached = await getCachedUser(queryUserId);
        if (cached && !cancelled) {
          applyData(cached);
          setLoading(false);
        }
        try {
          /* `cache: "no-store"` is essential, not an optimisation. Without it
             the browser revalidates this request and the server answers 304,
             for which `res.ok` is FALSE (304 is 3xx) — so a perfectly good
             response was being treated as a failure and the whole app dropped
             to "Failed to load user data". It also served a STALE role/dept
             from cache, which is how the admin dashboard kept flipping back
             to the agent screen after a role change. */
          const res = await fetch(`/api/user?id=${encodeURIComponent(queryUserId)}`, {
            credentials: "include",
            cache: "no-store",
          });
          if (!res.ok && res.status !== 304) {
            throw new Error(`Failed to fetch user data (${res.status})`);
          }
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

    return () => {
      cancelled = true;
    };
  }, [queryUserId, router]);

  // ── Activity logs: cached first, then paginated parallel fetch ───────────
  const fetchAccountAction = useCallback(async () => {
    if (!userDetails) return;
    setLoading(true);

    try {
      const { getCachedLogs } = await import("@/lib/offline-logs-cache");
      const cached = await getCachedLogs();
      if (cached.length > 0) {
        setPosts(cached as unknown as ActivityLog[]);
        setLoading(false);
      }
    } catch {
      /* silent */
    }

    try {
      const buildParams = (page: number) => {
        const params = new URLSearchParams();
        params.append("page", page.toString());
        params.append("limit", "500");
        params.append("role", userDetails.Role);
        if (userDetails.Role !== "SuperAdmin" && userDetails.Role !== "Human Resources") {
          params.append("referenceID", userDetails.ReferenceID);
        }
        if (dateCreatedFilterRange?.from) {
          params.append("startDate", dateCreatedFilterRange.from.toISOString());
          params.append(
            "endDate",
            (dateCreatedFilterRange.to ?? dateCreatedFilterRange.from).toISOString()
          );
        }
        return params;
      };

      const firstRes = await fetch(
        `/api/ModuleSales/Activity/FetchLog?${buildParams(1).toString()}`
      );
      if (!firstRes.ok) throw new Error("Failed to fetch logs");
      const firstData = await firstRes.json();
      const totalPages: number = firstData.pagination?.totalPages ?? 1;
      let allLogs: ActivityLog[] = firstData.data ?? [];

      setPosts(allLogs);
      setLoading(false);

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

      import("@/lib/offline-logs-cache")
        .then(({ cacheLogs }) => cacheLogs(allLogs as any))
        .catch(() => {});
    } catch {
      setPosts((prev) => (prev.length > 0 ? prev : []));
    } finally {
      setLoading(false);
    }
  }, [userDetails, dateCreatedFilterRange]);

  const { pendingCount, isOnline, isSyncing, syncNow } = useOfflineSync(fetchAccountAction);

  const { unreadCount: notifUnreadCount, markAllRead: markNotifsRead } = useNotifications(
    userDetails?.ReferenceID
  );

  const { prefs: appPrefs } = usePreferences();

  const fetchMeetings = useCallback(async () => {
    if (!userDetails) return;
    try {
      const params = new URLSearchParams();
      params.append("role", userDetails.Role);
      if (userDetails.Role !== "SuperAdmin" && userDetails.Role !== "Human Resources") {
        params.append("referenceID", userDetails.ReferenceID);
      }
      const res = await fetch(`/api/ModuleSales/Activity/Meeting?${params.toString()}`);
      if (res.ok) setMeetings(await res.json());
    } catch {
      /* silent */
    }
  }, [userDetails]);

  const { containerRef: swipeContainerRef, pullDistance, isRefreshing: isPullRefreshing } =
    useSwipeToRefresh(
      async () => {
        haptic("light");
        await Promise.all([fetchAccountAction(), fetchMeetings()]);
      },
      activeTab === "home" && appPrefs.swipeToRefresh
    );

  // ── Push notifications ───────────────────────────────────────────────────
  useEffect(() => {
    if (!userDetails?.UserId) return;
    if (!appPrefs.pushNotifications) return;
    import("@/lib/push-notifications")
      .then(({ initPushNotifications, onForegroundMessage }) => {
        initPushNotifications(userDetails.UserId).catch(() => {});
        const unsub = onForegroundMessage(({ title, body }) => {
          toast.info(`${title}: ${body}`, { duration: 6000 });
          playNotificationSound();
          if (appPrefs.notificationVibrate) haptic("warning");
        });
        return unsub;
      })
      .catch(() => {});
  }, [userDetails?.UserId, appPrefs.pushNotifications, appPrefs.notificationVibrate]);

  const prevNotifCount = useRef(0);
  useEffect(() => {
    if (
      notifUnreadCount > prevNotifCount.current &&
      prevNotifCount.current !== 0
    ) {
      playNotificationSound();
      if (appPrefs.notificationVibrate) haptic("warning");
    }
    prevNotifCount.current = notifUnreadCount;
  }, [notifUnreadCount, appPrefs.notificationVibrate]);

  useEffect(() => {
    if (!userDetails) return;
    Promise.all([fetchAccountAction(), fetchMeetings()]).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDetails, dateCreatedFilterRange]);

  // ── Directory lookup map, debounced ──────────────────────────────────────
  const usersMapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (posts.length === 0 && meetings.length === 0) return;
    if (usersMapTimer.current) clearTimeout(usersMapTimer.current);
    usersMapTimer.current = setTimeout(async () => {
      const refs = Array.from(
        new Set([
          ...posts.map((p) => p.ReferenceID),
          ...meetings.map((m) => m.ReferenceID),
        ])
      );
      try {
        const res = await fetch(`/api/users?referenceIDs=${refs.join(",")}`);
        if (!res.ok) return;
        const data = await res.json();
        const map: Record<string, UserInfo> = {};
        data.forEach((u: any) => {
          map[u.ReferenceID] = {
            Firstname: u.Firstname,
            Lastname: u.Lastname,
            profilePicture: u.profilePicture,
            TSM: u.TSM,
            Directories: u.Directories ?? [],
          };
        });
        setUsersMap(map);
      } catch {
        /* silent */
      }
    }, 800);
    return () => {
      if (usersMapTimer.current) clearTimeout(usersMapTimer.current);
    };
  }, [posts, meetings]);

  // ── Derived collections ──────────────────────────────────────────────────
  const isPrivileged =
    userDetails?.Role === "SuperAdmin" || userDetails?.Department === "Human Resources";

  const allVisibleAccounts = useMemo(() => {
    if (!userDetails) return [];
    if (isPrivileged) return posts;
    return posts.filter((p) => p.ReferenceID === userDetails.ReferenceID);
  }, [posts, userDetails, isPrivileged]);

  const allVisibleMeetings = useMemo(() => {
    if (!userDetails) return [];
    if (isPrivileged) return meetings;
    return meetings.filter((m) => m.ReferenceID === userDetails.ReferenceID);
  }, [meetings, userDetails, isPrivileged]);

  const groupedByDate = useMemo(() => {
    const g: Record<string, (ActivityLog | Meeting)[]> = {};
    allVisibleAccounts.forEach((p) => {
      const k = toDateKey(new Date(p.date_created));
      (g[k] ||= []).push(p);
    });
    allVisibleMeetings.forEach((m) => {
      const k = toDateKey(new Date(m.StartDate));
      (g[k] ||= []).push(m);
    });
    return g;
  }, [allVisibleAccounts, allVisibleMeetings]);

  const calendarDays = useMemo(
    () => generateCalendarDays(currentMonth.getFullYear(), currentMonth.getMonth()),
    [currentMonth]
  );

  const todayKey = toDateKey(today);
  const todayItems = groupedByDate[todayKey] || [];
  const todayLogs = todayItems.filter((i): i is ActivityLog => "date_created" in i);

  const todayVisits = useMemo(() => {
    const visits = allVisibleAccounts.filter(
      (p) =>
        (p.Status.toLowerCase() === "login" ||
          p.Status.toLowerCase() === "logout" ||
          p.Type.toLowerCase() === "client visit") &&
        toDateKey(new Date(p.date_created)) === todayKey
    );
    const todayMeetings = allVisibleMeetings.filter(
      (m) => toDateKey(new Date(m.StartDate)) === todayKey
    );
    return [...visits, ...todayMeetings];
  }, [allVisibleAccounts, allVisibleMeetings, todayKey]);

  const timelineItems = useMemo<TimelineItem[]>(
    () =>
      todayVisits
        .map((p) => {
          if ("Title" in p) {
            return {
              id: p._id ?? p.CreatedAt,
              title: p.Title,
              description: p.Remarks || "Meeting scheduled",
              location: p.Location || "",
              latitude: p.Latitude,
              longitude: p.Longitude,
              status: "Meeting",
              date: new Date(p.StartDate).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              }),
            };
          }
          return {
            id: p._id ?? p.date_created,
            title: p.Type === "Client Visit" ? p.SiteVisitAccount : p.Status,
            description: p.Remarks || "No remarks",
            location: p.Location || "",
            latitude: p.Latitude,
            longitude: p.Longitude,
            status: p.Status || "",
            type: p.Type || "",
            date: new Date(p.date_created).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }),
          };
        })
        .sort((a, b) => new Date(b.id).getTime() - new Date(a.id).getTime()),
    [todayVisits]
  );

  const monthlyStats = useMemo<MonthlyStats>(() => {
    const monthLogs = allVisibleAccounts.filter((p) => {
      const d = new Date(p.date_created);
      return (
        d.getFullYear() === currentMonth.getFullYear() &&
        d.getMonth() === currentMonth.getMonth()
      );
    });
    const loginDays = new Set(
      monthLogs
        .filter((l) => l.Status === "Login")
        .map((l) => toDateKey(new Date(l.date_created)))
    );
    const visits = monthLogs.filter((l) => l.Type === "Client Visit").length;
    const workDays = calendarDays.filter(
      (d) => d.getMonth() === currentMonth.getMonth() && d.getDay() !== 0 && d.getDay() !== 6
    ).length;
    return {
      present: loginDays.size,
      absent: Math.max(0, workDays - loginDays.size),
      visits,
      total: workDays,
    };
  }, [allVisibleAccounts, currentMonth, calendarDays]);

  // ── Derived attendance state (drives Clock In / Clock Out) ───────────────
  // Site-visit Time In/Time Out rows are deliberately excluded — see the
  // sequence note above next to isShiftLog().
  const clockedIn = useMemo(() => hasClockedIn(todayLogs), [todayLogs]);
  const clockedOut = useMemo(() => hasClockedOut(todayLogs), [todayLogs]);
  const isClockedIn = useMemo(() => isOnDuty(todayLogs), [todayLogs]);
  const nextClock = useMemo(() => nextClockAction(todayLogs), [todayLogs]);
  const shiftToday = useMemo(() => shiftLogs(todayLogs), [todayLogs]);
  const visitToday = useMemo(
    () => todayLogs.filter((l) => !isShiftLog(l)),
    [todayLogs]
  );

  const goToPrevMonth = useCallback(
    () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)),
    [currentMonth]
  );
  const goToNextMonth = useCallback(
    () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)),
    [currentMonth]
  );

  const onEventClick = useCallback((event: ActivityLog) => {
    setSelectedEvent(event);
    setDialogOpen(true);
  }, []);

  const onMeetingClick = useCallback((meeting: Meeting) => {
    setSelectedMeeting(meeting);
    setMeetingDialogOpen(true);
  }, []);

  const [createMeetingOpen, setCreateMeetingOpen] = useState(false);

  // ── Profile mutations ────────────────────────────────────────────────────
  const handleFaceRegister = useCallback(
    async (descriptors: number[][]) => {
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
        const userRes = await fetch(`/api/user?id=${encodeURIComponent(userId)}`);
        const userData = await userRes.json();
        setUserDetails((prev) =>
          prev ? { ...prev, faceDescriptors: userData.faceDescriptors } : null
        );
      } catch {
        toast.error("Error saving face data.");
      }
    },
    [userId]
  );

  const handleBiometricRegister = useCallback(async () => {
    if (!userId || !userDetails || biometricRegistering) return;
    setBiometricRegistering(true);
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const userKey = userDetails.ReferenceID || userDetails.Email;

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "Biolog", id: window.location.hostname },
          user: {
            id: Uint8Array.from(userKey, (c) => c.charCodeAt(0)),
            name: userDetails.Email,
            displayName: `${userDetails.Firstname} ${userDetails.Lastname}`,
          },
          pubKeyCredParams: [
            { alg: -7, type: "public-key" },
            { alg: -257, type: "public-key" },
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            residentKey: "required",
          },
          timeout: 60000,
          attestation: "none",
        } as PublicKeyCredentialCreationOptions,
      })) as any;

      if (!credential) throw new Error("Failed to create credential");

      const res = await fetch("/api/profile-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          credentials: [
            {
              id: credential.id,
              type: credential.type,
              rawId: Array.from(new Uint8Array(credential.rawId)),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error("Failed to save biometrics");

      toast.success("Biometrics registered successfully!");
      const userRes = await fetch(`/api/user?id=${encodeURIComponent(userId)}`);
      const userData = await userRes.json();
      setUserDetails((prev) =>
        prev ? { ...prev, credentials: userData.credentials } : null
      );
    } catch (err: any) {
      if (err?.name !== "NotAllowedError") {
        toast.error(err?.message || "Error registering biometrics.");
      }
    } finally {
      setBiometricRegistering(false);
    }
  }, [userId, userDetails, biometricRegistering]);

  const handleUpdateSecondaryEmail = useCallback(
    async (email: string) => {
      if (!userId) return;
      const res = await fetch("/api/profile-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, SecondaryEmail: email }),
      });
      if (!res.ok) throw new Error("Failed to update email");
      setUserDetails((prev) => (prev ? { ...prev, SecondaryEmail: email } : null));
    },
    [userId]
  );

  const handleUpdateFaceVerification = useCallback((enabled: boolean) => {
    setUserDetails((prev) => (prev ? { ...prev, faceVerificationEnabled: enabled } : null));
  }, []);

  return {
    // identity
    userId,
    userDetails,
    usersMap,
    // data
    posts,
    meetings,
    loading,
    error,
    allVisibleAccounts,
    allVisibleMeetings,
    groupedByDate,
    // calendar
    currentMonth,
    setCurrentMonth,
    calendarDays,
    today,
    todayKey,
    todayLogs,
    todayVisits,
    timelineItems,
    goToPrevMonth,
    goToNextMonth,
    // stats
    monthlyStats,
    isClockedIn,
    clockedIn,
    clockedOut,
    nextClock,
    shiftToday,
    visitToday,
    // offline / notifications
    pendingCount,
    isOnline,
    isSyncing,
    syncNow,
    notifUnreadCount,
    markNotifsRead,
    // nav
    activeTab,
    setActiveTab,
    // selection / dialogs
    selectedEvent,
    setSelectedEvent,
    dialogOpen,
    setDialogOpen,
    selectedMeeting,
    meetingDialogOpen,
    setMeetingDialogOpen,
    createMeetingOpen,
    setCreateMeetingOpen,
    faceRegisterOpen,
    setFaceRegisterOpen,
    biometricRegistering,
    // swipe
    swipeContainerRef,
    pullDistance,
    isPullRefreshing,
    // actions
    refresh: fetchAccountAction,
    fetchMeetings,
    handleLogout,
    handleFaceRegister,
    handleBiometricRegister,
    handleUpdateSecondaryEmail,
    handleUpdateFaceVerification,
    onEventClick,
    onMeetingClick,
  };
}

export type ActivityData = ReturnType<typeof useActivityData>;

// ── Shared derived helpers for screens ───────────────────────────────────────

/**
 * Sales-role check.
 *
 * The RBAC rule is keyed on Role = "Territory Sales Associate", NOT on
 * Department. Department alone was wrong: it is free-text, so "Sales",
 * "sales " and "SALES" all appear in real rows, and a non-TSA sitting in the
 * Sales department would wrongly unlock the sales drawer.
 *
 * Department is kept as a secondary signal so an existing TSA row that never
 * had its Role filled in still gets the sales drawer.
 */
export function isSales(user: UserDetails | null): boolean {
  if (!user) return false;
  const role = (user.Role || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (role) return role === "territory sales associate";
  return (user.Department || "").trim().toLowerCase() === "sales";
}

/**
 * Admin-role check.
 *
 * Uses the same normalisation as lib/rbac.ts — trimmed, whitespace-collapsed,
 * case-insensitive. Exact `=== "SuperAdmin"` was too brittle: this column is
 * hand-edited in Supabase and the live row reads "SuperAdmin" while other rows
 * hold "SUPERADMIN", "Super Admin" and "superadmin". A single mismatch here
 * silently showed a field agent the Clock In / Site Visit screen.
 */
export function isAdminish(user: UserDetails | null): boolean {
  if (!user) return false;
  const n = (s?: string | null) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();
  const role = n(user.Role);
  const dept = n(user.Department);
  return (
    role === "superadmin" ||
    role === "super admin" ||
    role === "admin" ||
    role === "administrator" ||
    dept === "it"
  );
}

/** Attendance helper: contextual advice instead of a bare number. */
export function attendanceAdvice(
  stats: MonthlyStats,
  monthLabel: string
): { rate: number; tone: "alert" | "clay" | "mint"; message: string } {
  const rate = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;
  if (stats.total === 0) {
    return {
      rate: 0,
      tone: "mint",
      message: "No work days logged yet this month.",
    };
  }
  if (rate >= 80) {
    return {
      rate,
      tone: "mint",
      message: `On track — ${stats.present} of ${stats.total} days in for ${monthLabel}.`,
    };
  }
  if (rate >= 50) {
    return {
      rate,
      tone: "clay",
      message: `${stats.absent} working day${stats.absent !== 1 ? "s" : ""} unaccounted for in ${monthLabel} — check your timesheet.`,
    };
  }
  return {
    rate,
    tone: "alert",
    message: `${stats.absent} days missing in ${monthLabel} — review your timesheet and log any missed clock-ins.`,
  };
}

/**
 * Was the Clock In late? Uses the On Field Login only — a site-visit Time In
 * must never be read as the shift start.
 */
export function computeLate(
  todayLogs: ActivityLog[],
  officeStart: string,
  gracePeriod: number
): boolean {
  const clockIn = firstClockIn(todayLogs);
  if (!clockIn) return false;
  const loginTime = new Date(clockIn.date_created);
  const [sH, sM] = officeStart.split(":").map(Number);
  const shiftStart = setPHTime(loginTime, sH || 0, sM || 0);
  return loginTime.getTime() > shiftStart.getTime() + gracePeriod * 60000;
}

export { getPHHour };
