// components/ProtectedPageWrapper.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ProtectedPageWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      // ── Offline fast-path ────────────────────────────────────────────────
      // If the browser is offline, skip the network check and rely on the
      // locally-stored offline session instead.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        try {
          const { getOfflineSession } = await import("@/lib/offline-auth");
          const userId = await getOfflineSession();
          if (userId) {
            setLoading(false);
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
        const res = await fetch("/api/check-session", {
          headers: { "x-device-id": deviceId },
        });

        if (res.status !== 200) {
          // Clear stale offline session on explicit auth failure
          try {
            const { clearOfflineSession } = await import("@/lib/offline-auth");
            await clearOfflineSession();
          } catch { /* silent */ }
          router.push("/Login");
          return;
        }

        setLoading(false);
      } catch {
        // Network error — try offline session as fallback
        try {
          const { getOfflineSession } = await import("@/lib/offline-auth");
          const userId = await getOfflineSession();
          if (userId) {
            setLoading(false);
            return;
          }
        } catch { /* silent */ }
        router.push("/Login");
      }
    };

    checkSession();
  }, [router]);

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
        className="mint-ui fixed inset-0 flex flex-col items-center justify-center gap-5"
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
        <div className="w-32 h-1 rounded-full bg-[var(--mint-soft)] overflow-hidden">
          <div
            className="h-full rounded-full animate-pulse-soft"
            style={{ background: "var(--mint)", width: "70%" }}
          />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
