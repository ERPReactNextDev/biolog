"use client";

/* ============================================================================
   BIOLOG · OB Request — "Calm Mint"
   ----------------------------------------------------------------------------
   Full-screen page reached from the agent Home quick action. Two tabs:
     A. Submit OB        — photograph the signed ROBT form and file it
     B. My OB Requests   — history, status, and the full detail view

   Composition root only. Reuses the Calm Mint primitives from
   app/activity-planner/mint/ui.tsx so it is indistinguishable from the rest of
   the agent app.
   ========================================================================== */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Plane } from "lucide-react";
import ProtectedPageWrapper from "@/components/protected-page-wrapper";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { SplashScreen } from "@/app/activity-planner/mint/states";
import { Button, cx } from "@/app/activity-planner/mint/ui";
import { useObData } from "./mint/ob-data";
import { ObSubmitTab } from "./mint/ob-submit";
import { ObDetail, ObHistoryTab } from "./mint/ob-list";
import type { ObRequest } from "@/lib/ob-requests";

type Tab = "submit" | "history";

function ObRequestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userId } = useUser();
  const queryUserId = searchParams?.get("id") ?? "";

  const data = useObData();
  const [tab, setTab] = useState<Tab>("submit");
  const [selected, setSelected] = useState<ObRequest | null>(null);

  /* A submitted request should immediately be visible in the history tab, and
     the agent usually wants to confirm it landed — but the success card already
     confirms it, so don't yank the screen out from under them. */
  useEffect(() => {
    if (selected) {
      // Keep the open detail in sync with a background refresh.
      const fresh = data.requests.find((r) => String(r.id) === String(selected.id));
      if (fresh) setSelected(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.requests]);

  const goBack = () => {
    router.push(`/activity-planner${queryUserId ? `?id=${encodeURIComponent(queryUserId)}` : ""}`);
  };

  if (data.loading && !data.profile) {
    return (
      <div className="fixed inset-0">
        <SplashScreen />
      </div>
    );
  }

  /* ── Detail view takes over the whole screen ──────────────────────────── */
  if (selected) {
    return (
      <div className="mint-root fixed inset-0 flex flex-col overflow-hidden">
        <div
          className="flex-shrink-0 px-5 pt-12 pb-6 relative overflow-hidden"
          style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--bg) 100%)" }}
        >
          <div
            className="absolute -top-12 -right-12 w-44 h-44 rounded-full pointer-events-none"
            style={{ background: "rgba(13,150,105,.05)" }}
          />
          <div className="relative z-10 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Back to my OB requests"
              className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 transition-colors active:scale-95"
              style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
            >
              <ChevronLeft size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="text-[19px] font-black text-[var(--text)] leading-tight">
                View Details
              </h1>
              <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                Official Business Trip request
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 mint-scroll px-4 pt-4 pb-8">
          <ObDetail
            row={selected}
            onBack={() => setSelected(null)}
            onSubmitAnother={() => {
              setSelected(null);
              setTab("submit");
            }}
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
        className="flex-shrink-0 px-5 pt-12 pb-5 relative overflow-hidden"
        style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--bg) 100%)" }}
      >
        <div
          className="absolute -top-12 -right-12 w-44 h-44 rounded-full pointer-events-none"
          style={{ background: "rgba(212,114,74,.06)" }}
        />
        <div className="relative z-10 flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            aria-label="Go back"
            className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 transition-colors active:scale-95"
            style={{ background: "var(--clay-soft)", color: "var(--clay-ink)" }}
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-black text-[var(--text)] leading-tight">
              Request for Official Business Trip
            </h1>
            <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-0.5">
              Photograph your signed ROBT form
            </p>
          </div>
          <div
            className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
            style={{ background: "var(--clay-soft)", color: "var(--clay-ink)" }}
            aria-hidden
          >
            <Plane size={19} />
          </div>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="OB request sections"
          className="relative z-10 flex gap-1 mt-4 p-1 rounded-[15px]"
          style={{ background: "rgba(255,255,255,.7)", border: "1px solid var(--border)" }}
        >
          {(
            [
              { key: "submit", label: "Submit OB" },
              { key: "history", label: "My OB Requests" },
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
                {t.key === "history" && data.counts.all > 0 && (
                  <span className="ml-1.5 opacity-70">{data.counts.all}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 mint-scroll px-4 pt-4 pb-8">
        {tab === "submit" ? (
          <ObSubmitTab
            profile={data.profile}
            userId={queryUserId || userId || undefined}
            onSubmitted={data.refresh}
          />
        ) : (
          <ObHistoryTab
            requests={data.requests}
            loading={data.loading}
            error={data.error}
            refreshing={data.refreshing}
            onRetry={data.refresh}
            onNewRequest={() => setTab("submit")}
            onOpen={setSelected}
          />
        )}
      </div>

      {/* A reviewer gets a shortcut to the console so they can approve from here
          too, rather than having to remember the /admin/ob-approvals URL.
          `counts.pending` covers both Pending Review and For COO Approval. */}
      {data.isReviewer && tab === "history" && data.counts.pending > 0 && (
        <div className="flex-shrink-0 px-4 pb-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
          <Button
            variant="secondary"
            size="sm"
            full
            onClick={() => router.push("/admin/ob-approvals")}
            icon={<Plane size={15} />}
          >
            {data.counts.pending} awaiting approval — open reviewer console
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <ProtectedPageWrapper>
      <UserProvider>
        <div className="mint-root">
          <ObRequestPage />
        </div>
      </UserProvider>
    </ProtectedPageWrapper>
  );
}