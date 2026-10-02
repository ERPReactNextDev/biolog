"use client";

/* ============================================================================
   BIOLOG · Group Visitation — "Calm Mint"
   ----------------------------------------------------------------------------
   Full-screen page from the agent Home quick action. Two tabs: the feed of
   visits this agent may join, and the create form. Selecting a card opens the
   detail view, which takes over the screen.

   Every restriction decision comes from the server. This page never decides who
   may see or join anything — it renders what /api/group-visits returned.
   ========================================================================== */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { toast } from "sonner";
import ProtectedPageWrapper from "@/components/protected-page-wrapper";
import { UserProvider } from "@/contexts/UserContext";
import { SplashScreen } from "@/app/activity-planner/mint/states";
import { cx } from "@/app/activity-planner/mint/ui";
import {
  loadTeamIndex,
  teamOf,
  type Member,
} from "@/lib/group-visits";
import { GroupVisitFeed } from "./mint/gv-feed";
import { GroupVisitCreate, type CreatePayload } from "./mint/gv-create";
import { GroupVisitDetail } from "./mint/gv-detail";
import { type GroupVisitCard } from "./mint/gv-shared";

type Tab = "feed" | "create";

export default function GroupVisitationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryUserId = searchParams?.get("id") ?? "";

  const [tab, setTab] = useState<Tab>("feed");
  const [cards, setCards] = useState<GroupVisitCard[]>([]);
  const [membersById, setMembersById] = useState<Map<string, Member[]>>(new Map());
  const [viewer, setViewer] = useState<{
    referenceId: string;
    role: string;
    teamSize?: number;
    isTeamLeader?: boolean;
  } | null>(null);
  const [counts, setCounts] = useState({ all: 0, today: 0, joined: 0, mine: 0 });
  const [profile, setProfile] = useState<{ referenceId: string; role: string } | null>(null);
  const [teamSize, setTeamSize] = useState(0);
  const [clientNames, setClientNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // WHICH action is in flight, not just which visit — the detail view labels
  // its buttons "Joining…", "Leaving…", "Checking in…" from this.
  const [busy, setBusy] = useState<{ visitId: number | string; action: string } | null>(null);
  const [selected, setSelected] = useState<GroupVisitCard | null>(null);
  const [creating, setCreating] = useState(false);

  /* ── Load ─────────────────────────────────────────────────────────────── */

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/group-visits?scope=feed", {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not load group visits.");

      setCards((json.visits || []) as GroupVisitCard[]);
      setViewer(json.viewer || null);
      if (json.counts) setCounts(json.counts);
      // Avatar stacks come from the same response — no extra request per card.
      if (Array.isArray(json.members)) {
        // Pairs of [visitId, Member[]] — the same response, so the avatar stack
        // and the detail list cost no extra request.
        setMembersById(new Map(json.members as [string, Member[]][]));
      }
    } catch (err: any) {
      setError(err?.message || "Could not load group visits.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* Team size + role for the create form, both supplied by the feed response. */
  useEffect(() => {
    if (!viewer) return;
    setTeamSize(viewer.teamSize ?? 0);
    setProfile((p) => p || { referenceId: viewer.referenceId, role: viewer.role });
  }, [viewer]);

  /* Existing client names, for the company datalist. Best effort. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fetch-account?referenceid=" + encodeURIComponent(""), {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const list = json?.data || json?.accounts || [];
        if (!cancelled && Array.isArray(list)) {
          setClientNames(
            list
              .map((a: any) => a.company_name || a.SiteVisitAccount)
              .filter((n: any): n is string => typeof n === "string" && n.trim() !== "")
          );
        }
      } catch {
        /* the datalist is a convenience only */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Members for the open detail, fetched once per selection. */
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/group-visits?scope=one&id=${selected.id}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (cancelled) return;
        const fresh = (json.visits || [])[0] as GroupVisitCard | undefined;
        // Keep the detail in sync, but never let a 403 swap the screen out.
        if (fresh) setSelected(fresh);
        if (Array.isArray(json.members)) {
          setMembersById((prev) => new Map(prev).set(String(selected.id), json.members));
        }
      } catch {
        /* keep what we already have */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  /* ── Actions ─────────────────────────────────────────────────────────── */

  const act = useCallback(
    async (card: GroupVisitCard, action: "join" | "leave" | "cancel" | "checkin") => {
      setBusy({ visitId: card.id, action });
      try {
        const res = await fetch("/api/group-visits/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ visitId: card.id, action }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          // The server's reason is the same text the disabled button showed, so
          // a crafted request and a tapped button explain themselves alike.
          toast.error(json?.error || "That did not work.");
          return;
        }
        if (json.cancelled) {
          toast.success("Group visit cancelled.");
          setSelected(null);
        } else {
          toast.success(
            action === "join"
              ? `You're on the ${card.CompanyName} visit.`
              : action === "leave"
                ? "You left the visit."
                : action === "checkin"
                  ? "Checked in."
                  : "Done."
          );
        }
        await load(true);
      } catch {
        toast.error("Network problem — nothing was changed.");
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const create = useCallback(
    async (payload: CreatePayload) => {
      setCreating(true);
      try {
        const res = await fetch("/api/group-visits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(json?.error || "Could not create the group visit.");
          return;
        }
        toast.success(
          json.visibility === "team_only"
            ? "Group visit created. Your team has been notified."
            : "Group visit created and shared with the company."
        );
        setTab("feed");
        await load(true);
      } catch {
        toast.error("Network problem — the visit was not created.");
      } finally {
        setCreating(false);
      }
    },
    [load]
  );

  const goBack = () => {
    router.push(`/activity-planner${queryUserId ? `?id=${encodeURIComponent(queryUserId)}` : ""}`);
  };

  const openCount = useMemo(
    () => cards.filter((c) => c.canJoin && c.Status !== "Completed" && c.Status !== "Cancelled").length,
    [cards]
  );

  if (loading && !profile && cards.length === 0) {
    return (
      <div className="mint-root fixed inset-0">
        <SplashScreen />
      </div>
    );
  }

  /* ── Detail view ──────────────────────────────────────────────────────── */

  if (selected) {
    return (
      <div className="mint-root fixed inset-0 flex flex-col overflow-hidden">
        <div
          className="flex-shrink-0 px-5 pt-12 pb-6"
          style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--bg) 100%)" }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Back to group visits"
              className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
              style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
            >
              <ChevronLeft size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="text-[19px] font-black text-[var(--text)] leading-tight">
                Group Visit
              </h1>
              <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                {selected.CompanyName}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 mint-scroll px-4 pt-4 pb-8">
          <GroupVisitDetail
            card={selected}
            members={membersById.get(String(selected.id)) || []}
            viewerRef={viewer?.referenceId || profile?.referenceId || ""}
            busy={busy?.visitId === selected.id ? busy.action : null}
            onJoin={() => act(selected, "join")}
            onLeave={() => act(selected, "leave")}
            onCancel={() => act(selected, "cancel")}
            onCheckIn={() => act(selected, "checkin")}
            onBack={() => setSelected(null)}
          />
        </div>
      </div>
    );
  }

  /* ── Main screen ──────────────────────────────────────────────────────── */

  return (
    <div className="mint-root fixed inset-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex-shrink-0 px-5 pt-12 pb-5"
        style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--bg) 100%)" }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            aria-label="Go back"
            className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-black text-[var(--text)] leading-tight">
              Group Visitation
            </h1>
            <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-0.5">
              Join or create a team visit
            </p>
          </div>
          <div
            className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
            aria-hidden
          >
            <Users size={19} />
          </div>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Group visit sections"
          className="flex gap-1 mt-4 p-1 rounded-[15px]"
          style={{ background: "rgba(255,255,255,.7)", border: "1px solid var(--border)" }}
        >
          {(
            [
              { key: "feed", label: "For You" },
              { key: "create", label: "Create" },
            ] as const
          ).map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cx(
                  "flex-1 min-h-[40px] rounded-[12px] text-[12.5px] font-extrabold transition-all active:scale-[0.98]",
                  active ? "text-white shadow-[var(--sh-btn)]" : "text-[var(--text-muted)]"
                )}
                style={active ? { background: "var(--mint-btn)" } : undefined}
              >
                {t.label}
                {t.key === "feed" && counts.today > 0 && (
                  <span className="ml-1.5 opacity-70">{counts.today}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 mint-scroll px-4 pt-4 pb-8">
        {tab === "feed" ? (
          <GroupVisitFeed
            visits={cards}
            membersById={membersById}
            loading={loading}
            error={error}
            busyFor={busy?.visitId ?? null}
            busyAction={busy?.action ?? null}
            todayCount={counts.today}
            onRetry={load}
            onOpen={setSelected}
            onJoin={(c) => act(c, "join")}
            onLeave={(c) => act(c, "leave")}
            onCreate={() => setTab("create")}
          />
        ) : (
          <GroupVisitCreate
            role={profile?.role}
            teamSize={teamSize}
            clientNames={clientNames}
            busy={creating}
            onSubmit={create}
            onCancel={() => setTab("feed")}
          />
        )}
      </div>

      {/* Joinable-visits nudge */}
      {tab === "feed" && openCount > 0 && (
        <div className="flex-shrink-0 px-4 pb-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
          <p className="text-[11.5px] font-bold text-center" style={{ color: "var(--mint-strong)" }}>
            {openCount} group visit{openCount === 1 ? "" : "s"} you can join right now
          </p>
        </div>
      )}
    </div>
  );
}

/* Team size and role arrive on the feed response (see the viewer's
   `teamSize`), so there is no separate request and no client-side copy of the
   eligibility rules. */