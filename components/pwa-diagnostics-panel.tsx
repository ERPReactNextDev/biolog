"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type DiagnosticsState = {
  online: boolean;
  controller: string | null;
  registrationScope: string | null;
  activeWorker: string | null;
  waitingWorker: string | null;
  installingWorker: string | null;
  cacheNames: string[];
  activityPlannerCached: boolean | null;
  error: string | null;
  refreshedAt: string | null;
};

function formatWorkerLabel(scriptUrl: string | null) {
  if (!scriptUrl) return "none";

  try {
    const url = new URL(scriptUrl);
    return url.pathname;
  } catch {
    return scriptUrl;
  }
}

async function isPathCached(pathname: string) {
  if (typeof window === "undefined" || typeof caches === "undefined") {
    return null;
  }

  const absoluteUrl = new URL(pathname, window.location.origin).toString();
  const cacheNames = await caches.keys();

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const match = (await cache.match(pathname)) ?? (await cache.match(absoluteUrl));
    if (match) return true;
  }

  return false;
}

export default function PWADiagnosticsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [state, setState] = useState<DiagnosticsState>({
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    controller: null,
    registrationScope: null,
    activeWorker: null,
    waitingWorker: null,
    installingWorker: null,
    cacheNames: [],
    activityPlannerCached: null,
    error: null,
    refreshedAt: null,
  });

  const refreshDiagnostics = useCallback(async () => {
    if (typeof window === "undefined") return;

    setIsRefreshing(true);

    try {
      const nextState: DiagnosticsState = {
        online: navigator.onLine,
        controller: navigator.serviceWorker?.controller?.scriptURL ?? null,
        registrationScope: null,
        activeWorker: null,
        waitingWorker: null,
        installingWorker: null,
        cacheNames: [],
        activityPlannerCached: null,
        error: null,
        refreshedAt: new Date().toLocaleTimeString(),
      };
      const errors: string[] = [];

      if (navigator.serviceWorker) {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          nextState.registrationScope = registration?.scope ?? null;
          nextState.activeWorker = registration?.active?.scriptURL ?? null;
          nextState.waitingWorker = registration?.waiting?.scriptURL ?? null;
          nextState.installingWorker = registration?.installing?.scriptURL ?? null;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "Failed to read service worker registration.");
        }
      }

      if (typeof caches !== "undefined") {
        try {
          nextState.cacheNames = await caches.keys();
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "Failed to read cache names.");
        }

        try {
          nextState.activityPlannerCached = await isPathCached("/activity-planner");
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "Failed to check /activity-planner cache.");
        }
      }

      nextState.error = errors.length ? errors.join(" ") : null;
      setState(nextState);
    } catch (error) {
      setState((current) => ({
        ...current,
        online: typeof navigator !== "undefined" ? navigator.onLine : current.online,
        error: error instanceof Error ? error.message : "Failed to read PWA diagnostics.",
        refreshedAt: new Date().toLocaleTimeString(),
      }));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshDiagnostics();

    const handleWindowChange = () => {
      refreshDiagnostics();
    };

    window.addEventListener("online", handleWindowChange);
    window.addEventListener("offline", handleWindowChange);
    window.addEventListener("focus", handleWindowChange);
    document.addEventListener("visibilitychange", handleWindowChange);
    navigator.serviceWorker?.addEventListener("controllerchange", handleWindowChange);

    return () => {
      window.removeEventListener("online", handleWindowChange);
      window.removeEventListener("offline", handleWindowChange);
      window.removeEventListener("focus", handleWindowChange);
      document.removeEventListener("visibilitychange", handleWindowChange);
      navigator.serviceWorker?.removeEventListener("controllerchange", handleWindowChange);
    };
  }, [refreshDiagnostics]);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="mt-4 rounded-2xl border border-gray-200 bg-white/90 shadow-sm"
      data-testid="pwa-diagnostics-panel"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
            PWA Diagnostics
          </p>
          <p className="truncate text-[12px] text-gray-400">
            Online: <span data-testid="pwa-online-status">{state.online ? "yes" : "no"}</span>
            {" · "}
            Controlled: <span data-testid="pwa-controlled-status">{state.controller ? "yes" : "no"}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refreshDiagnostics()}
            disabled={isRefreshing}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Refresh PWA diagnostics"
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
          </button>
          <CollapsibleTrigger
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50"
            aria-label="Toggle PWA diagnostics"
          >
            <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent className="border-t border-gray-100 px-4 py-3">
        <dl className="grid grid-cols-1 gap-2 text-[12px] text-gray-600">
          <div className="flex items-start justify-between gap-3">
            <dt className="font-semibold text-gray-500">Controller</dt>
            <dd className="text-right font-mono text-[11px]" data-testid="pwa-controller-value">
              {formatWorkerLabel(state.controller)}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="font-semibold text-gray-500">Registration Scope</dt>
            <dd className="text-right font-mono text-[11px]">
              {state.registrationScope ?? "none"}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="font-semibold text-gray-500">Active Worker</dt>
            <dd className="text-right font-mono text-[11px]" data-testid="pwa-active-worker-value">
              {formatWorkerLabel(state.activeWorker)}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="font-semibold text-gray-500">Waiting Worker</dt>
            <dd className="text-right font-mono text-[11px]">
              {formatWorkerLabel(state.waitingWorker)}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="font-semibold text-gray-500">Installing Worker</dt>
            <dd className="text-right font-mono text-[11px]">
              {formatWorkerLabel(state.installingWorker)}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="font-semibold text-gray-500">/activity-planner Cached</dt>
            <dd className="text-right font-mono text-[11px]" data-testid="pwa-activity-planner-cached">
              {state.activityPlannerCached === null ? "unknown" : state.activityPlannerCached ? "yes" : "no"}
            </dd>
          </div>
          <div className="flex flex-col gap-1 rounded-xl bg-gray-50 px-3 py-2">
            <dt className="font-semibold text-gray-500">Cache Names</dt>
            <dd className="font-mono text-[11px] text-gray-600" data-testid="pwa-cache-names">
              {state.cacheNames.length ? state.cacheNames.join(", ") : "none"}
            </dd>
          </div>
          {state.refreshedAt ? (
            <div className="flex items-start justify-between gap-3">
              <dt className="font-semibold text-gray-500">Refreshed</dt>
              <dd className="text-right font-mono text-[11px]">{state.refreshedAt}</dd>
            </div>
          ) : null}
          {state.error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              {state.error}
            </div>
          ) : null}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
