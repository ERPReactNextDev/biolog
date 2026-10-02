"use client";

/* ============================================================================
   HOME — greeting, live status, announcement, quick actions, monthly progress
   ========================================================================== */

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  Image as ImageIcon,
  MapPin,
  Megaphone,
  ThermometerSun,
  Cloud,
  CloudRain,
  CloudLightning,
  LogIn,
  LogOut,
  Plus,
  Repeat,
  Store,
  Users,
} from "lucide-react";
import {
  Button,
  Card,
  Eyebrow,
  Hint,
  Pill,
  ProgressBar,
  ProgressRing,
  SectionLabel,
} from "./ui";
import { useAdminAuth } from "./admin-home";
import { SplashScreen } from "./states";
import NotificationBell from "@/components/notifications/notification-bell";
import {
  attendanceAdvice,
  computeLate,
  firstClockIn,
  getPHHour,
  greetingFor,
  isOnDuty,
  isSales,
  logActionLabel,
  nextClockAction,
  timeAgoLabel,
  useLiveClock,
  useSystemSettings,
  type ActivityData,
} from "./data";
import { formatPHDate } from "@/lib/ph-time";

function WeatherChip() {
  const [temp, setTemp] = React.useState<number | null>(null);
  const [cond, setCond] = React.useState<number>(0);

  React.useEffect(() => {
    let cancelled = false;
    // Open-Meteo, no API key. Metro Manila default coords.
    fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=14.5995&longitude=120.9842&current=temperature_2m,weather_code"
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.current) return;
        setTemp(Math.round(Number(d.current.temperature_2m)));
        setCond(Number(d.current.weather_code));
      })
      .catch(() => {
        /* weather is decorative — never block the UI on it */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (temp === null) return null;

  const Icon =
    cond >= 95
      ? CloudLightning
      : cond >= 51
        ? CloudRain
        : cond === 0
          ? ThermometerSun
          : Cloud;

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-[var(--card)] border border-[var(--border)] px-3 h-9">
      <Icon size={14} className="text-[var(--clay)]" />
      <span className="mint-num text-[12px] font-extrabold text-[var(--text)]">{temp}°C</span>
    </div>
  );
}

function StepPill({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className={
        "text-[10px] font-extrabold px-2 py-1 rounded-full " +
        (done
          ? "bg-[var(--mint-soft)] text-[var(--mint-strong)]"
          : "bg-[var(--bg)] text-[var(--text-faint)]")
      }
      style={done ? undefined : { border: "1px solid var(--border)" }}
    >
      {done && "✓ "}
      {label}
    </span>
  );
}

function QuickAction({
  icon,
  title,
  subtitle,
  tone,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tone: "mint" | "clay" | "info";
  onClick: () => void;
  /** Optional count rendered on the icon tile, e.g. joinable group visits. */
  badge?: number;
}) {
  const map = {
    mint: { bg: "var(--mint-soft)", fg: "var(--mint-strong)" },
    clay: { bg: "var(--clay-soft)", fg: "var(--clay-ink)" },
    info: { bg: "var(--info-soft)", fg: "var(--info)" },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className="mint-tap text-left rounded-[var(--r-card-lg)] border border-[var(--border)] bg-[var(--card)] p-3.5 shadow-[var(--sh-card)] active:bg-[var(--mint-soft)]"
    >
      <div
        className="w-10 h-10 rounded-[13px] flex items-center justify-center mb-2.5 relative"
        style={{ background: map.bg, color: map.fg }}
      >
        {icon}
        {!!badge && badge > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full flex items-center justify-center text-[9.5px] font-black text-white"
            style={{ background: "var(--alert)", boxShadow: "0 0 0 2px var(--card)" }}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </div>
      <p className="text-[13.5px] font-extrabold text-[var(--text)] leading-tight">{title}</p>
      <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
        {subtitle}
      </p>
    </button>
  );
}

export function HomeScreen({
  data,
  groupVisitJoinable = 0,
  onOpenSiteVisit,
  onOpenAttendance,
}: {
  data: ActivityData;
  /** Group visits this agent can join right now — badge on the quick action. */
  groupVisitJoinable?: number;
  onOpenSiteVisit: () => void;
  onOpenAttendance: () => void;
}) {
  const router = useRouter();
  const settings = useSystemSettings();
  const clock = useLiveClock();
  const adminAuth = useAdminAuth();
  const { userDetails, todayLogs, monthlyStats, currentMonth, setActiveTab, isOnline } = data;

  const monthLabel = currentMonth.toLocaleString("en-US", { month: "long" });
  const advice = useMemo(
    () => attendanceAdvice(monthlyStats, monthLabel),
    [monthlyStats, monthLabel]
  );
  const late = useMemo(
    () => computeLate(todayLogs, settings.officeStartTime, settings.gracePeriod),
    [todayLogs, settings.officeStartTime, settings.gracePeriod]
  );

  // Shift state only — a site-visit Time In/Time Out must not affect this.
  const firstLogin = useMemo(() => firstClockIn(todayLogs), [todayLogs]);
  const onDuty = isOnDuty(todayLogs);
  const { clockedIn, clockedOut, visitToday } = data;

  // A field agent visits MANY clients a day, so Time In / Time Out repeat.
  // Clock In and Clock Out happen once. Track visits as a count, not a step.
  const visitsStarted = visitToday.filter((v: any) => v.Status === "Login").length;
  const visitsClosed = visitToday.filter((v: any) => v.Status === "Logout").length;
  const openVisits = Math.max(0, visitsStarted - visitsClosed);

  const clockedInAt = firstLogin
    ? new Date(firstLogin.date_created).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "";

  const initials = userDetails
    ? `${userDetails.Firstname[0] ?? ""}${userDetails.Lastname[0] ?? ""}`.toUpperCase()
    : "?";

  // Clock In once → Time In/Out for every client → Clock Out once
  const actionHint = !onDuty
    ? `Your shift starts at ${settings.officeStartTime}. Clock in once, then log a Time In and Time Out for every client you visit.`
    : visitsStarted === 0
      ? `Clocked in at ${clockedInAt}. No visits logged yet — record a Time In when you reach your first client.`
      : `Clocked in at ${clockedInAt} · ${visitsStarted} client visit${visitsStarted !== 1 ? "s" : ""}${
          openVisits > 0 ? `, ${openVisits} still open` : " done"
        }. Clock out once when you finish for the day.`;

  /* ── Super Admin sees an admin dashboard, not the agent Home ───────────────
     Decided by the SESSION, never by `?id=`. Gating on the URL param meant a
     Super Admin who landed on a TSA's id was demoted to the agent screen, and
     a TSA who landed on an admin's id was shown the admin dashboard — which
     leaked user counts and GPS report locations.

     While the session is still being checked we show the splash rather than
     the agent screen, so the agent view never flashes for an admin. */
  if (adminAuth.status === "loading") {
    return (
      <div className="px-5 pt-12 pb-8 bg-[var(--bg)]">
        <SplashScreen />
      </div>
    );
  }

  if (adminAuth.status === "yes") {
    // Redirect to the full desktop admin console — rendering inside the mobile
    // shell clips the sidebar layout and shows the old card dashboard.
    if (typeof window !== "undefined") {
      window.location.replace("/admin");
    }
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 bg-[var(--bg)]">
        <SplashScreen />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* ── Header (soft mint gradient, never solid red) ──────────────────── */}
      <div className="mint-header px-5 pt-12 pb-16 flex-shrink-0 relative overflow-hidden">
        <div
          className="absolute -top-12 -right-12 w-44 h-44 rounded-full pointer-events-none"
          style={{ background: "rgba(13,150,105,.05)" }}
        />
        <div
          className="absolute -bottom-20 -left-10 w-52 h-52 rounded-full pointer-events-none"
          style={{ background: "rgba(13,150,105,.035)" }}
        />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-[12px] bg-[var(--mint-btn)] flex items-center justify-center shadow-[var(--sh-btn)]">
                {settings.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={settings.logoUrl} alt="Biolog" className="w-full h-full object-contain p-1" />
                ) : (
                  <svg width="19" height="19" viewBox="0 0 18 18" fill="none" aria-hidden>
                    <rect x="2" y="8" width="14" height="2" rx="1" fill="white" />
                    <rect x="2" y="4" width="9" height="2" rx="1" fill="white" />
                    <rect x="2" y="12" width="11" height="2" rx="1" fill="white" />
                  </svg>
                )}
              </div>
              <span className="text-[15px] font-black tracking-[0.12em] text-[var(--mint-strong)]">
                BIOLOG
              </span>
            </div>
            <div className="flex items-center gap-2">
              <WeatherChip />
              <NotificationBell
                bell="agent"
                agentUserId={data.userId}
                tone="surface"
                size={18}
              />
              <button
                type="button"
                onClick={() => setActiveTab("profile")}
                aria-label="Open profile"
                className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-[var(--card)]"
              >
                {userDetails?.profilePicture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={userDetails.profilePicture} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center bg-[var(--mint-btn)] text-white text-[12px] font-black">
                    {initials}
                  </span>
                )}
              </button>
            </div>
          </div>

          <p className="text-[13px] font-bold text-[var(--text-muted)] mb-0.5">
            {greetingFor(getPHHour(new Date()))} <span aria-hidden>👋</span>
          </p>
          <h1 className="text-[23px] font-black text-[var(--text)] leading-tight tracking-tight">
            {userDetails ? `${userDetails.Firstname} ${userDetails.Lastname}` : "Loading…"}
          </h1>
          <p className="text-[12px] font-bold text-[var(--text-muted)] mt-0.5 uppercase tracking-wide">
            {userDetails?.Role ?? "—"} · {userDetails?.Department ?? "—"}
          </p>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 mint-scroll px-4 -mt-10 pb-32">
        {/* Current status card — must stack ABOVE the gradient header */}
        <Card className="relative z-20 p-4 shadow-[var(--sh-card-lg)] mb-4">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Current Status</SectionLabel>
            {/* Live clock, top-left of the card so the header stays clean */}
            <Pill tone="mint" dot pulse>
              {onDuty ? "On Duty" : "Active"}
            </Pill>
          </div>

          <div className="flex items-stretch gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Clock size={22} className="text-[var(--mint)] shrink-0" />
                <p className="mint-num text-[30px] font-black text-[var(--text)] leading-none">
                  {clock}
                </p>
              </div>
              <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-2 flex items-start gap-1.5">
                <CalendarDays size={13} className="shrink-0 mt-px" />
                {formatPHDate(new Date(), {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>

            <div className="w-px bg-[var(--border)]" />

            <div className="flex-1 min-w-0">
              <SectionLabel>Work Shift</SectionLabel>
              <p className="mint-num text-[15px] font-black text-[var(--text)] mt-1.5">
                {settings.officeStartTime} – {settings.officeEndTime}
              </p>
              <div className="mt-2">
                {onDuty ? (
                  late ? (
                    <Pill tone="clay" dot>
                      Late arrival
                    </Pill>
                  ) : (
                    <Pill tone="mint" dot>
                      On schedule
                    </Pill>
                  )
                ) : (
                  <Pill tone="alert" dot>
                    Not in
                  </Pill>
                )}
              </div>
            </div>
          </div>

          {/* The day runs Clock In → Time In → Time Out → Clock Out.
              The button always offers the next shift step, never the visits. */}
          <div className="mt-4">
            {onDuty ? (
              <Button
                variant="clockout"
                full
                size="lg"
                icon={<LogOut size={20} />}
                onClick={onOpenAttendance}
              >
                Clock Out
              </Button>
            ) : (
              <Button
                full
                size="lg"
                icon={<LogIn size={20} />}
                onClick={onOpenAttendance}
              >
                Clock In Now
              </Button>
            )}
            <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-2.5 leading-relaxed text-center">
              {actionHint}
            </p>
          </div>

          {/* Clock In and Clock Out are once-per-day. Time In / Time Out repeat
              for every client, so the middle is a loop with a count, not a step. */}
          <div className="mt-3.5 flex items-center justify-center gap-1.5 flex-wrap">
            <StepPill label="Clock In" done={clockedIn} />

            <ChevronRight size={11} className="text-[var(--text-faint)] shrink-0" />

            <span
              className={
                "text-[10px] font-extrabold px-2 py-1 rounded-full flex items-center gap-1 " +
                (visitsStarted > 0
                  ? "bg-[var(--mint-soft)] text-[var(--mint-strong)]"
                  : "bg-[var(--bg)] text-[var(--text-faint)]")
              }
              style={visitsStarted > 0 ? undefined : { border: "1px solid var(--border)" }}
              title="Time In and Time Out repeat for every client you visit"
            >
              <Repeat size={10} />
              Time In / Out
              {visitsStarted > 0 && (
                <span className="mint-num">×{visitsStarted}</span>
              )}
              {openVisits > 0 && (
                <span style={{ color: "var(--clay-ink)" }}>· {openVisits} open</span>
              )}
            </span>

            <ChevronRight size={11} className="text-[var(--text-faint)] shrink-0" />

            <StepPill label="Clock Out" done={clockedOut} />
          </div>
        </Card>

        {/* Admin announcement */}
        {settings.announcement && (
          <Card className="p-4 mb-4" style={{ background: "var(--info-soft)", borderColor: "transparent" }}>
            <div className="flex gap-3">
              <div
                className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
                style={{ background: "var(--card)", color: "var(--info)" }}
              >
                <Megaphone size={19} />
              </div>
              <div className="min-w-0">
                <p
                  className="text-[10px] font-black uppercase tracking-[0.14em] mb-1"
                  style={{ color: "var(--info)" }}
                >
                  Admin Announcement
                </p>
                <p
                  className="text-[13px] font-bold leading-relaxed"
                  style={{ color: "var(--text)" }}
                >
                  {settings.announcement}
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Quick actions */}
        <Eyebrow>Quick Actions</Eyebrow>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <QuickAction
            icon={<MapPin size={19} />}
            title="Site Visit"
            subtitle="Record client visit"
            tone="clay"
            onClick={onOpenSiteVisit}
          />
          <QuickAction
            icon={<Users size={19} />}
            title="Group Visitation"
            subtitle="Join or create a team visit"
            tone="mint"
            badge={groupVisitJoinable}
            onClick={() =>
              router.push(
                `/group-visitation${data.userId ? `?id=${encodeURIComponent(data.userId)}` : ""}`
              )
            }
          />
          <QuickAction
            icon={<ImageIcon size={19} />}
            title="OB Request"
            subtitle="Upload signed OB form"
            tone="clay"
            onClick={() =>
              router.push(
                `/ob-request${data.userId ? `?id=${encodeURIComponent(data.userId)}` : ""}`
              )
            }
          />
          <QuickAction
            icon={<CalendarDays size={19} />}
            title="Calendar"
            subtitle="View monthly logs"
            tone="info"
            onClick={() => setActiveTab("calendar")}
          />
          <QuickAction
            icon={<BarChart3 size={19} />}
            title="Reports"
            subtitle="Attendance summary"
            tone="mint"
            onClick={() => setActiveTab("reports")}
          />
          <QuickAction
            icon={<FileSpreadsheet size={19} />}
            title="Timesheet"
            subtitle="Hours & overtime"
            tone="mint"
            onClick={() =>
              router.push(
                `/time-attendance/timesheet${data.userId ? `?id=${encodeURIComponent(data.userId)}` : ""}`
              )
            }
          />
          <QuickAction
            icon={<MapPin size={19} />}
            title="Submit GPS Report"
            subtitle="Send your location"
            tone="clay"
            onClick={() =>
              router.push(
                `/gps-report${data.userId ? `?id=${encodeURIComponent(data.userId)}` : ""}`
              )
            }
          />
        </div>

        {/* Today's timeline */}
        {data.timelineItems.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-2.5">
              <SectionLabel>Today&apos;s Activity</SectionLabel>
              <button
                type="button"
                onClick={() => setActiveTab("calendar")}
                className="text-[11.5px] font-extrabold text-[var(--mint-strong)] flex items-center gap-0.5 min-h-[32px]"
              >
                See all <ChevronRight size={14} />
              </button>
            </div>
            <Card className="divide-y divide-[var(--border)] mb-4">
              {data.timelineItems.slice(0, 3).map((item) => (
                <div key={item.id} className="px-4 py-3 flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
                    style={{
                      background:
                        item.status === "Login"
                          ? "var(--mint-soft)"
                          : item.status === "Logout"
                            ? "var(--info-soft)"
                            : item.status === "Meeting"
                              ? "var(--info-soft)"
                              : "var(--clay-soft)",
                      color:
                        item.status === "Login"
                          ? "var(--mint-strong)"
                          : item.status === "Logout"
                            ? "var(--info)"
                            : item.status === "Meeting"
                              ? "var(--info)"
                              : "var(--clay-ink)",
                    }}
                  >
                    {item.status === "Login" ? (
                      <LogIn size={16} />
                    ) : item.status === "Logout" ? (
                      <LogOut size={16} />
                    ) : item.status === "Meeting" ? (
                      <CalendarDays size={16} />
                    ) : (
                      <Store size={16} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-extrabold text-[var(--text)] truncate">
                        {item.status === "Login" || item.status === "Logout"
                          ? logActionLabel(item.type, item.status)
                          : item.status === "Meeting"
                            ? item.title
                            : item.title || "Site Visit"}
                      </p>
                      <span className="mint-num text-[11px] font-bold text-[var(--text-faint)] shrink-0">
                        {item.date}
                      </span>
                    </div>
                    <p className="text-[11.5px] font-medium text-[var(--text-muted)] mt-0.5 line-clamp-1">
                      {item.location || "No location recorded"}
                    </p>
                  </div>
                </div>
              ))}
            </Card>
          </>
        )}

        {/* Monthly attendance progress */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <SectionLabel>Monthly Attendance</SectionLabel>
              <p className="mint-num text-[13px] font-extrabold text-[var(--text)] mt-1">
                {monthlyStats.present} / {monthlyStats.total} days
              </p>
            </div>
            <ProgressRing value={advice.rate} size={62} stroke={7}>
              <span
                className="mint-num text-[14px] font-black"
                style={{
                  color:
                    advice.tone === "alert"
                      ? "var(--alert-ink)"
                      : advice.tone === "clay"
                        ? "var(--clay-ink)"
                        : "var(--mint-strong)",
                }}
              >
                {advice.rate}%
              </span>
            </ProgressRing>
          </div>

          <ProgressBar
            value={advice.rate}
            tone={
              advice.tone === "alert"
                ? "var(--alert)"
                : advice.tone === "clay"
                  ? "var(--clay)"
                  : "var(--mint)"
            }
          />

          {/* No bare numbers — always explain what to do next */}
          <div className="mt-3">
            {advice.tone === "mint" ? (
              <p className="text-[11.5px] font-bold text-[var(--mint-strong)] flex items-start gap-1.5">
                <Store size={13} className="shrink-0 mt-px" />
                {advice.message}
              </p>
            ) : (
              <Hint icon={<Clock size={13} />}>{advice.message}</Hint>
            )}
          </div>

          <Button
            variant="secondary"
            size="sm"
            full
            className="mt-3"
            onClick={() => setActiveTab("reports")}
          >
            Open full report
          </Button>
        </Card>

        {!isOnline && (
          <p className="text-[11px] font-bold text-[var(--clay-ink)] text-center mt-4">
            You&apos;re offline — entries save to this phone and sync automatically.
          </p>
        )}
      </div>
    </div>
  );
}
