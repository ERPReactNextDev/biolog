"use client";

/* ============================================================================
   Group Visitation · Tab A — feed of visits this agent can actually join
   ----------------------------------------------------------------------------
   The list arrives already filtered by the server (lib/group-visits.canSee), so
   a restricted visit is never even sent to the browser. What this component
   adds is the JOIN state, which also came from the server.
   ========================================================================== */

import React, { useMemo, useState } from "react";
import { CalendarPlus, Search, Users } from "lucide-react";
import { Button, EmptyState, ErrorState, Skeleton } from "@/app/activity-planner/mint/ui";
import type { Member } from "@/lib/group-visits";
import {
  GroupVisitCardView,
  type GroupVisitCard,
} from "./gv-shared";

type Filter = "today" | "upcoming" | "joined" | "mine";

const CHIPS: { key: Filter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "joined", label: "Joined" },
  { key: "mine", label: "Created by Me" },
];

export function GroupVisitFeed({
  visits,
  membersById,
  loading,
  error,
  busyFor,
  busyAction,
  onRetry,
  onOpen,
  onJoin,
  onLeave,
  onCreate,
  todayCount,
}: {
  visits: GroupVisitCard[];
  membersById: Map<string, Member[]>;
  loading: boolean;
  error: string | null;
  busyFor: number | string | null;
  busyAction: string | null;
  onRetry: () => void;
  onOpen: (card: GroupVisitCard) => void;
  onJoin: (card: GroupVisitCard) => void;
  onLeave: (card: GroupVisitCard) => void;
  onCreate: () => void;
  todayCount: number;
}) {
  const [filter, setFilter] = useState<Filter>("today");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return visits.filter((v) => {
      // "Today" must still surface what you already joined or created today,
      // otherwise a join disappears from the list the moment you tap it.
      if (filter === "today") {
        const isToday = v.relativeDay === "Today";
        if (!isToday && !v.isMember && !v.isCreator) return false;
      }
      if (filter === "upcoming" && (v.Status === "Completed" || v.Status === "Cancelled")) {
        return false;
      }
      if (filter === "joined" && !v.isMember) return false;
      if (filter === "mine" && !v.isCreator) return false;

      if (!q) return true;
      return [v.CompanyName, v.creatorName, v.MeetingPoint, v.Purpose]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
  }, [visits, filter, search]);

  if (loading && visits.length === 0) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-[188px] rounded-[var(--r-card-lg)]" />
        ))}
      </div>
    );
  }

  if (error && visits.length === 0) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  return (
    <div className="space-y-3">
      {/* Filters + search */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-4 px-4">
        {CHIPS.map((c) => {
          const active = filter === c.key;
          const n =
            c.key === "today"
              ? todayCount
              : c.key === "joined"
                ? visits.filter((v) => v.isMember).length
                : c.key === "mine"
                  ? visits.filter((v) => v.isCreator).length
                  : visits.filter((v) => v.Status !== "Completed" && v.Status !== "Cancelled").length;

          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              aria-pressed={active}
              className="shrink-0 min-h-[36px] px-3.5 rounded-full text-[12px] font-extrabold border transition-all active:scale-95"
              style={
                active
                  ? { background: "var(--mint-btn)", color: "#fff", borderColor: "transparent" }
                  : { background: "var(--card)", color: "var(--text-muted)", borderColor: "var(--border)" }
              }
            >
              {c.label}
              {n > 0 && <span className="ml-1.5 opacity-70">{n}</span>}
            </button>
          );
        })}
      </div>

      {visits.length > 3 && (
        <label
          className="flex items-center gap-2.5 h-[44px] px-3.5 rounded-[14px] border bg-[var(--card)]"
          style={{ borderColor: "var(--border)" }}
        >
          <Search size={15} style={{ color: "var(--text-faint)" }} className="shrink-0" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, organiser, meeting point…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] font-semibold"
            style={{ color: "var(--text)" }}
          />
        </label>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title={visits.length === 0 ? "Walang group visit para sa'yo ngayon" : "Nothing in this filter"}
          message={
            visits.length === 0
              ? "Gumawa ng group visit, o hintayin ang iyong TSM. Kapag may team visit na puwede sa'yo, lalabas dito."
              : "Try a different filter or clear the search."
          }
          ctaLabel="Create a group visit"
          onCta={onCreate}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((card) => (
            <GroupVisitCardView
              key={card.id}
              card={card}
              members={membersById.get(String(card.id)) || []}
              busy={busyFor === card.id ? busyAction : null}
              onOpen={() => onOpen(card)}
              onJoin={() => onJoin(card)}
              onLeave={() => onLeave(card)}
            />
          ))}
        </div>
      )}

      {/* Nudge to create when the feed is thin */}
      {filtered.length > 0 && filtered.length <= 2 && (
        <Button
          variant="secondary"
          size="md"
          full
          onClick={onCreate}
          icon={<CalendarPlus size={17} />}
        >
          Create another group visit
        </Button>
      )}
    </div>
  );
}