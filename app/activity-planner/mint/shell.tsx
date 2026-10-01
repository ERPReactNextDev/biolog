"use client";

/* ============================================================================
   APP SHELL — bottom nav with center FAB, plus the floating location pin
   ----------------------------------------------------------------------------
   Active item is a filled mint pill with white text (per the brief).
   ========================================================================== */

import React from "react";
import { BarChart3, CalendarDays, Home, MapPin, Plus, User } from "lucide-react";
import { cx } from "./ui";
import { haptic } from "@/lib/haptics";
import type { ActivityData, ActiveTab } from "./data";

const NAV: { id: ActiveTab; Icon: typeof Home; label: string }[] = [
  { id: "home", Icon: Home, label: "Home" },
  { id: "calendar", Icon: CalendarDays, label: "Calendar" },
  { id: "reports", Icon: BarChart3, label: "Reports" },
  { id: "profile", Icon: User, label: "Profile" },
];

export function BottomNav({
  active,
  onChange,
  onFab,
  notifCount,
  showFab,
}: {
  active: ActiveTab;
  onChange: (t: ActiveTab) => void;
  onFab: () => void;
  notifCount: number;
  showFab: boolean;
}) {
  return (
    <nav
      className="shrink-0 relative bg-[var(--card)] border-t border-[var(--border)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Main navigation"
    >
      {/* Notch for the center FAB */}
      {showFab && (
        <svg
          className="absolute -top-[26px] left-0 w-full pointer-events-none"
          height="28"
          viewBox="0 0 390 28"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M0 28 L142 28 Q166 28 173 14 Q180 0 195 0 Q210 0 217 14 Q224 28 248 28 L390 28 Z"
            fill="var(--card)"
          />
          <path
            d="M0 28 L142 28 Q166 28 173 14 Q180 0 195 0 Q210 0 217 14 Q224 28 248 28"
            fill="none"
            stroke="var(--border)"
            strokeWidth="1"
          />
        </svg>
      )}

      <div className="flex items-center">
        {NAV.map(({ id, Icon, label }, idx) => {
          const isActive = active === id;
          const isFabSlot = idx === 1; // sits immediately left of the center FAB
          return (
            <React.Fragment key={id}>
              <button
                type="button"
                onClick={() => {
                  haptic("light");
                  onChange(id);
                }}
                aria-current={isActive ? "page" : undefined}
                className={cx(
                  "flex-1 flex flex-col items-center justify-center gap-1 min-h-[60px] relative transition-all",
                  showFab && isFabSlot && "pr-6"
                )}
              >
                <span
                  className={cx(
                    "flex items-center justify-center rounded-full transition-all duration-200",
                    isActive
                      ? "bg-[var(--mint-btn)] text-white h-7 w-12 shadow-[0_4px_12px_rgba(13,150,105,.28)]"
                      : "text-[var(--text-muted)] h-7 w-12"
                  )}
                >
                  <Icon size={19} strokeWidth={isActive ? 2.4 : 1.9} />
                </span>
                <span
                  className={cx(
                    "text-[10px] font-extrabold leading-none",
                    isActive ? "text-[var(--mint-strong)]" : "text-[var(--text-muted)]"
                  )}
                >
                  {label}
                </span>

                {id === "profile" && notifCount > 0 && (
                  <span className="absolute top-2.5 right-[22%] w-4 h-4 rounded-full bg-[var(--alert)] flex items-center justify-center text-[8px] font-black text-white">
                    {notifCount > 9 ? "9+" : notifCount}
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Center FAB */}
      {showFab && (
        <div className="absolute -top-[22px] left-1/2 -translate-x-1/2 z-10">
          <button
            type="button"
            onClick={() => {
              haptic("medium");
              onFab();
            }}
            aria-label="Log attendance or site visit"
            className="w-14 h-14 rounded-full flex items-center justify-center border-4 transition-all active:scale-95"
            style={{
              background: "var(--mint-btn)",
              borderColor: "var(--card)",
              boxShadow: "0 8px 22px rgba(13,150,105,.42)",
            }}
          >
            <Plus size={23} className="text-white" strokeWidth={2.6} />
          </button>
        </div>
      )}
    </nav>
  );
}

/** Floating location-pin button — opens today's activity + GPS tools. */
export function LocationFab({
  count,
  onClick,
  bottomOffset,
}: {
  count: number;
  onClick: () => void;
  bottomOffset: number;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic("light");
        onClick();
      }}
      aria-label={`Today's activity, ${count} records`}
      className="absolute z-40 w-12 h-12 rounded-[16px] flex items-center justify-center transition-all active:scale-95"
      style={{
        right: 16,
        bottom: bottomOffset,
        background: "var(--card)",
        border: "1px solid var(--border)",
        boxShadow: "0 6px 18px rgba(15,23,42,.12)",
      }}
    >
      <MapPin size={20} style={{ color: "var(--mint)" }} />
      {count > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[9px] font-black text-white border-2"
          style={{ background: "var(--mint)", borderColor: "var(--card)" }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
