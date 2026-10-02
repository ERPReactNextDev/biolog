"use client";

/* ============================================================================
   CALENDAR — month grid, stat strip, day detail, activity timeline
   ========================================================================== */

import React, { useMemo, useState } from "react";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  LogIn,
  LogOut,
  MapPin,
  Store,
  Users,
} from "lucide-react";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Pill,
  ProgressBar,
  SectionLabel,
  cx,
} from "./ui";
import {
  attendanceAdvice,
  isShiftLog,
  toDateKey,
  type ActivityData,
  type ActivityLog,
  type Meeting,
} from "./data";

type Filter = "All" | "Login" | "Logout" | "Site Visit" | "Meeting";

const FILTERS: Filter[] = ["All", "Login", "Logout", "Site Visit", "Meeting"];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** Monday-first column index. */
function mondayIndex(d: Date) {
  return (d.getDay() + 6) % 7;
}

function matchesFilter(item: ActivityLog | Meeting, filter: Filter): boolean {
  if (filter === "All") return true;
  if (filter === "Meeting") return "Title" in item;
  if ("Title" in item) return false;
  if (filter === "Site Visit") return item.Type === "Client Visit";
  return item.Status === filter;
}

export function CalendarScreen({
  data,
  onCreateMeeting,
}: {
  data: ActivityData;
  onCreateMeeting: () => void;
}) {
  const { currentMonth, calendarDays, groupedByDate, todayKey, monthlyStats } = data;
  const [filter, setFilter] = useState<Filter>("All");
  const [selectedKey, setSelectedKey] = useState<string>(todayKey);

  const monthLabel = currentMonth.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  const advice = useMemo(
    () => attendanceAdvice(monthlyStats, currentMonth.toLocaleString("en-US", { month: "long" })),
    [monthlyStats, currentMonth]
  );

  const daysInMonth = useMemo(
    () => calendarDays.filter((d) => d.getMonth() === currentMonth.getMonth()),
    [calendarDays, currentMonth]
  );
  const leading = useMemo(() => mondayIndex(calendarDays[0]), [calendarDays]);

  const selectedItems = useMemo(() => {
    const items = groupedByDate[selectedKey] || [];
    return items
      .filter((i) => matchesFilter(i, filter))
      .sort((a, b) => {
        const at = "Title" in a ? new Date(a.StartDate).getTime() : new Date(a.date_created).getTime();
        const bt = "Title" in b ? new Date(b.StartDate).getTime() : new Date(b.date_created).getTime();
        return at - bt;
      });
  }, [groupedByDate, selectedKey, filter]);

  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedKey.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [selectedKey]);

  const selectedLabel = formatFullDate(selectedDate);
  const isToday = selectedKey === todayKey;

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* Header */}
      <div className="mint-header px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={data.goToPrevMonth}
            aria-label="Previous month"
            className="w-11 h-11 rounded-[14px] bg-[var(--card)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] active:bg-[var(--mint-soft)]"
          >
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[19px] font-black text-[var(--text)] tracking-tight">
            {monthLabel}
          </h1>
          <button
            type="button"
            onClick={data.goToNextMonth}
            aria-label="Next month"
            className="w-11 h-11 rounded-[14px] bg-[var(--card)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] active:bg-[var(--mint-soft)]"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Month stats strip */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { v: monthlyStats.present, l: "Present", c: "var(--mint-strong)" },
            { v: monthlyStats.absent, l: "Absent", c: "var(--alert-ink)" },
            { v: monthlyStats.visits, l: "Visits", c: "var(--clay-ink)" },
            { v: `${advice.rate}%`, l: "Rate", c: "var(--info)" },
          ].map((s) => (
            <div
              key={s.l}
              className="rounded-[14px] bg-[var(--card)] border border-[var(--border)] py-2.5 text-center"
            >
              <p className="mint-num text-[19px] font-black leading-none" style={{ color: s.c }}>
                {s.v}
              </p>
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--text-muted)] mt-1">
                {s.l}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 mint-scroll px-4 pb-32">
        {/* Month grid */}
        <Card className="p-3 mt-3 mb-4">
          <div className="grid grid-cols-7 gap-1 mb-1.5">
            {WEEKDAYS.map((w, i) => (
              <div
                key={`${w}-${i}`}
                className="text-center text-[10px] font-black uppercase text-[var(--text-faint)] py-1"
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {leading > 0 &&
              Array.from({ length: leading }).map((_, i) => (
                <div key={`pad-${i}`} />
              ))}

            {daysInMonth.map((day) => {
              const key = toDateKey(day);
              const items = groupedByDate[key] || [];
              const inMonth = day.getMonth() === currentMonth.getMonth();
              const weekend = day.getDay() === 0 || day.getDay() === 6;
              // "Present" means the shift was started, so only On Field rows
              // count — a site-visit Time In is not a clock-in.
              const hasPresent = items.some(
                (i) => !("Title" in i) && i.Status === "Login" && isShiftLog(i)
              );
              const hasVisit = items.some(
                (i) => "Type" in i && i.Type === "Client Visit"
              );
              const hasMeeting = items.some((i) => "Title" in i);
              const isSelected = key === selectedKey;
              const isToday = key === todayKey;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedKey(key);
                  }}
                  aria-label={`${day.getDate()} ${day.toLocaleString("en-US", { month: "long" })}${
                    items.length ? `, ${items.length} records` : ""
                  }`}
                  aria-pressed={isSelected}
                  className={cx(
                    "relative rounded-[13px] py-1.5 min-h-[52px] flex flex-col items-center justify-center transition-all active:scale-95",
                    isSelected && "bg-[var(--mint-btn)] shadow-[0_4px_12px_rgba(13,150,105,.3)]",
                    !isSelected && !inMonth && "opacity-35",
                    !isSelected && inMonth && weekend && "bg-[var(--bg)]",
                    !isSelected && inMonth && !weekend && "hover:bg-[var(--mint-soft)]"
                  )}
                >
                  <span
                    className={cx(
                      "mint-num text-[13px] font-black leading-none",
                      isSelected
                        ? "text-white"
                        : weekend
                          ? "text-[var(--text-faint)]"
                          : "text-[var(--text)]"
                    )}
                  >
                    {day.getDate()}
                  </span>
                  <span className="text-[8px] font-black uppercase leading-none mt-0.5">
                    {isToday ? (
                      <span
                        className={cx(
                          "px-1 rounded-full",
                          isSelected ? "bg-white/25 text-white" : "bg-[var(--mint-soft] text-[var(--mint-strong)]"
                        )}
                      >
                        Today
                      </span>
                    ) : (
                      <span
                        className={cx(
                          "px-1 rounded-full",
                          isSelected ? "text-white/80" : "text-transparent"
                        )}
                      >
                        d
                      </span>
                    )}
                  </span>
                  {/* Status dots: green = present, orange = visit, blue = meeting */}
                  <span className="flex items-center gap-0.5 mt-0.5 h-1">
                    {hasPresent && (
                      <span
                        className={cx("w-1 h-1 rounded-full", isSelected ? "bg-white" : "bg-[var(--mint)]")}
                      />
                    )}
                    {hasVisit && (
                      <span
                        className={cx("w-1 h-1 rounded-full", isSelected ? "bg-white" : "bg-[var(--clay)]")}
                      />
                    )}
                    {hasMeeting && (
                      <span
                        className={cx("w-1 h-1 rounded-full", isSelected ? "bg-white" : "bg-[var(--info)]")}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-[var(--border)]">
            {[
              { c: "var(--mint)", l: "Present" },
              { c: "var(--clay)", l: "Visit" },
              { c: "var(--info)", l: "Meeting" },
            ].map((x) => (
              <span key={x.l} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: x.c }} />
                <span className="text-[10px] font-bold text-[var(--text-muted)]">{x.l}</span>
              </span>
            ))}
          </div>
        </Card>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto mint-scroll pb-1 -mx-4 px-4 mb-4">
          {FILTERS.map((f) => (
            <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
              {f}
            </Chip>
          ))}
        </div>

        {/* Day timeline */}
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <SectionLabel>{isToday ? "Today" : "Selected Day"}</SectionLabel>
            <p className="text-[15px] font-extrabold text-[var(--text)] mt-0.5">
              {selectedLabel}
            </p>
          </div>
          {isToday && <Pill tone="mint" dot>Today</Pill>}
        </div>

        {selectedItems.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing logged yet"
              message={
                filter === "All"
                  ? "No activity recorded for this day. Add a site visit or schedule a meeting to start a trail."
                  : `No "${filter}" records for this day. Try a different filter to see other activity.`
              }
              ctaLabel={filter === "All" ? "Schedule Activity" : "Show all activity"}
              onCta={filter === "All" ? onCreateMeeting : () => setFilter("All")}
              icon={<CalendarPlus size={26} />}
            />
          </Card>
        ) : (
          <div className="space-y-2.5">
            {selectedItems.map((item, idx) => {
              const isMeeting = "Title" in item;
              const log = item as ActivityLog;
              const time = isMeeting
                ? new Date((item as Meeting).StartDate).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  })
                : new Date(log.date_created).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  });

              // Clock In/Out (shift) and Time In/Out (site visit) are distinct
              // events that happen to share Status values.
              const isVisit = log.Type === "Client Visit";
              const isEntry = log.Status === "Login";

              const tone = isMeeting
                ? { bg: "var(--info-soft)", fg: "var(--info)" }
                : isEntry
                  ? { bg: "var(--mint-soft)", fg: "var(--mint-strong)" }
                  : { bg: "var(--clay-soft)", fg: "var(--clay-ink)" };

              const label = isMeeting
                ? (item as Meeting).Title
                : isVisit
                  ? isEntry
                    ? "Time In · Arrived at client"
                    : "Time Out · Left client"
                  : isEntry
                    ? "Clock In · Shift started"
                    : "Clock Out · Shift ended";

              const subtitle = isMeeting
                ? (item as Meeting).Location || (item as Meeting).CompanyName || "Meeting"
                : isVisit
                  ? log.SiteVisitAccount || "Client visit"
                  : "Attendance";

              const Icon = isMeeting
                ? Users
                : isVisit
                  ? isEntry
                    ? LogIn
                    : LogOut
                  : isEntry
                    ? Clock
                    : Clock;

              return (
                <div key={`${item._id ?? "x"}-${idx}`} className="flex gap-3">
                  {/* Timeline rail */}
                  <div className="flex flex-col items-center shrink-0 pt-1">
                    <div
                      className="w-8 h-8 rounded-[11px] flex items-center justify-center"
                      style={{ background: tone.bg, color: tone.fg }}
                    >
                      <Icon size={15} />
                    </div>
                    {idx < selectedItems.length - 1 && (
                      <div className="w-px flex-1 min-h-[16px] mt-1 bg-[var(--border)]" />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      isMeeting
                        ? data.onMeetingClick(item as Meeting)
                        : data.onEventClick(log)
                    }
                    className="mint-tap flex-1 min-w-0 text-left rounded-[var(--r-card)] border border-[var(--border)] bg-[var(--card)] p-3 mb-0.5 shadow-[var(--sh-card)] active:bg-[var(--mint-soft)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13.5px] font-extrabold text-[var(--text)] leading-tight">
                        {label}
                      </p>
                      <span className="mint-num text-[12px] font-black text-[var(--text)] shrink-0">
                        {time}
                      </span>
                    </div>
                    <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-1 leading-snug line-clamp-1">
                      {subtitle}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <MapPin size={11} className="text-[var(--text-faint)] shrink-0" />
                      <span className="text-[10.5px] font-semibold text-[var(--text-faint)] line-clamp-1">
                        {log.Location || "Location not recorded"}
                      </span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Always-available primary action */}
        <Button
          full
          size="md"
          className="mt-5"
          icon={<CalendarPlus size={18} />}
          onClick={onCreateMeeting}
        >
          Schedule Activity
        </Button>
      </div>
    </div>
  );
}

function formatFullDate(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
