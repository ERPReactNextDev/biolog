// hooks/useSessionTimeout.ts
// Warns the user 2 minutes before their 7-day session expires
// and offers a one-click refresh.

"use client";

import { useEffect, useRef, useCallback, useState } from "react";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const WARN_BEFORE_MS      = 2 * 60 * 1000;            // warn 2 min before expiry
const LS_KEY              = "acculog_session_start";

export interface SessionTimeoutState {
  showWarning: boolean;
  secondsLeft: number;
  refresh: () => Promise<void>;
  dismiss: () => void;
}

export function useSessionTimeout(): SessionTimeoutState {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current)    clearTimeout(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const startCountdown = useCallback(() => {
    setSecondsLeft(120);
    countdownRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(countdownRef.current!);
          // Session expired — redirect to login
          window.location.href = "/Login";
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  const scheduleWarning = useCallback(() => {
    clearTimers();

    const sessionStart = parseInt(localStorage.getItem(LS_KEY) ?? "0", 10) || Date.now();
    localStorage.setItem(LS_KEY, String(sessionStart));

    const elapsed   = Date.now() - sessionStart;
    const remaining = SESSION_DURATION_MS - elapsed;
    const warnIn    = remaining - WARN_BEFORE_MS;

    if (warnIn <= 0) {
      // Already in warning window
      setShowWarning(true);
      startCountdown();
      return;
    }

    timerRef.current = setTimeout(() => {
      setShowWarning(true);
      startCountdown();
    }, warnIn);
  }, [clearTimers, startCountdown]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/refresh-session", { method: "POST" });
      if (res.ok) {
        localStorage.setItem(LS_KEY, String(Date.now()));
        setShowWarning(false);
        clearTimers();
        scheduleWarning();
      }
    } catch {
      // If refresh fails, just dismiss — user will be redirected on next API call
      setShowWarning(false);
      clearTimers();
    }
  }, [clearTimers, scheduleWarning]);

  const dismiss = useCallback(() => {
    setShowWarning(false);
    clearTimers();
  }, [clearTimers]);

  useEffect(() => {
    scheduleWarning();
    return clearTimers;
  }, [scheduleWarning, clearTimers]);

  return { showWarning, secondsLeft, refresh, dismiss };
}
