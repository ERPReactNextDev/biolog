// components/ProtectedPageWrapper.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithTimeout, isTimeout } from "@/lib/fetch-timeout";

/** Hard ceiling on how long the splash may stay up. */
const SESSION_TIMEOUT_MS = 10_000;
/** After this long, offer a retry instead of an unexplained wait. */
const SLOW_AFTER_MS = 6_000;

export default function ProtectedPageWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const checkSession = useCallback(async () => {
    setLoading(true);
    setSlow(false);

    // Belt and braces: even if the fetch somehow never settles, the splash
    // must not outlive this. Without it a stalled request is unrecoverable.
    const failsafe = setTimeout(() => {
      if (alive.current) setSlow(true);
    }, SLOW_AFTER_MS);

    try {
      // ── Offline fast-path ────────────────────────────────────────────────
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        try {
          const { getOfflineSession } = await import("@/lib/offline-auth");
          const userId = await getOfflineSession();
          if (userId) {
            if (alive.current) setLoading(false);
            return;
          }
        } catch {
          // IndexedDB unavailable — fall through to redirect
        }
        router.push("/Login");
        return;
      }

      // ── Online path ──────────────────────────────────────────────────────
      try {
        const deviceId = localStorage.getItem("deviceId") || "";
        const res = await fetchWithTimeout(
          "/api/check-session",
          { headers: { "x-device-id": deviceId } },
          SESSION_TIMEOUT_MS
        );

        if (res.status !== 200) {
          // Clear stale offline session on explicit auth failure
          try {
            const { clearOfflineSession } = await import("@/lib/offline-auth");
            await clearOfflineSession();
          } catch { /* silent */ }
          router.push("/Login");
          return;
        }

        if (alive.current) setLoading(false);
      } catch (err) {
        // Timeout or network error — try the offline session as fallback.
        // If we timed out we still prefer showing the app over bouncing the
        // user to Login, since we cannot prove the session is invalid.
        try {
          const { getOfflineSession } = await import("@/lib/offline-auth");
          const userId = await getOfflineSession();
          if (userId) {
            if (alive.current) setLoading(false);
            return;
          }
        } catch { /* silent */ }

        if (alive.current && isTimeout(err)) {
          // Could not verify. Offer a retry instead of an endless splash.
          setSlow(true);
          return;
        }
        router.push("/Login");
      }
    } finally {
      clearTimeout(failsafe);
    }
  }, [router]);

  useEffect(() => {
    checkSession();
  }, [checkSession, attempt]);

  useEffect(() => {
    // Apply theme — gracefully skip if offline
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then(data => {
        if (data.themeColor) {
          document.documentElement.setAttribute("data-theme", data.themeColor);
        }
      })
      .catch(() => { /* silent — offline */ });
  }, []);

  if (loading) {
    // Matches the in-app SplashScreen so the handoff from gate -> app is seamless
    return (
      <div
        className="mint-ui fixed inset-0 flex flex-col items-center justify-center gap-5 px-6"
        style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--bg) 100%)" }}
        role="status"
        aria-label="Loading Biolog"
      >
        <div
          className="w-[72px] h-[72px] rounded-[22px] flex items-center justify-center"
          style={{ background: "var(--mint-btn)", boxShadow: "var(--sh-btn)" }}
        >
          <svg width="34" height="34" viewBox="0 0 18 18" fill="none" aria-hidden>
            <rect x="2" y="8" width="14" height="2" rx="1" fill="white" />
            <rect x="2" y="4" width="9" height="2" rx="1" fill="white" />
            <rect x="2" y="12" width="11" height="2" rx="1" fill="white" />
          </svg>
        </div>
        <p className="text-[20px] font-black tracking-[0.16em] text-[var(--mint-strong)]">BIOLOG</p>

        {/* Indeterminate sweep — the old bar sat frozen at 70% forever, which
            read as a crash rather than as progress. */}
        <div className="w-32 h-1 rounded-full bg-[var(--mint-soft)] overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              background: "var(--mint)",
              width: "40%",
              animation: "mint-splash-sweep 1.4s ease-in-out infinite",
            }}
          />
        </div>

        {slow ? (
          /* Something is wrong and the user needs a way out. */
          <div className="flex flex-col items-center gap-3 mt-2">
            <p className="text-[12.5px] font-bold text-[var(--text-muted)] text-center max-w-[16rem] leading-relaxed">
              This is taking longer than usual. Check your connection, then try again.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="min-h-[44px] px-6 rounded-[var(--r-btn)] text-[13.5px] font-extrabold border transition-colors active:scale-[0.98]"
                style={{
                  background: "var(--mint-btn)",
                  color: "white",
                  boxShadow: "var(--sh-btn)",
                }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => router.push("/Login")}
                className="min-h-[44px] px-5 rounded-[var(--r-btn)] text-[13.5px] font-extrabold border transition-colors active:scale-[0.98]"
                style={{
                  background: "var(--card)",
                  borderColor: "var(--border-strong)",
                  color: "var(--text)",
                }}
              >
                Sign in
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[11.5px] font-semibold text-[var(--text-faint)]">
            Checking your session…
          </p>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
