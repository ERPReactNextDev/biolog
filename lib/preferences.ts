"use client";
// lib/preferences.ts
// User preferences stored in localStorage with a reactive React hook.

import { useEffect, useState } from "react";

export interface UserPreferences {
  haptics: boolean;
  notificationSound: boolean;
  notificationVibrate: boolean;
  pushNotifications: boolean;
  showWeather: boolean;
  showOfflineBanner: boolean;
  swipeToRefresh: boolean;
  cameraTimerEnabled: boolean;
  cameraTimerSeconds: number;
}

const DEFAULTS: UserPreferences = {
  haptics:             true,
  notificationSound:   true,
  notificationVibrate: true,
  pushNotifications:   true,
  showWeather:         true,
  showOfflineBanner:   true,
  swipeToRefresh:      true,
  cameraTimerEnabled:  true,
  cameraTimerSeconds:  10,
};

const STORAGE_KEY = "biolog_prefs_v1";

const PREF_EVENT  = "biolog:prefs-changed";

function readPrefs(): UserPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(prefs: UserPreferences) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(PREF_EVENT));
  } catch { /* silent */ }
}

/** Sync getter — safe to use inside utilities like haptic() and playSound(). */
export function getPreferences(): UserPreferences {
  return readPrefs();
}

/** Reactive hook — components re-render when any preference changes. */
export function usePreferences() {
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULTS);

  useEffect(() => {
    setPrefs(readPrefs());
    const handler = () => setPrefs(readPrefs());
    if (typeof window !== "undefined") {
      window.addEventListener(PREF_EVENT, handler);
      window.addEventListener("storage", handler);
      return () => {
        window.removeEventListener(PREF_EVENT, handler);
        window.removeEventListener("storage", handler);
      };
    }
    return undefined;
  }, []);

  function setPref(key: keyof UserPreferences, value: boolean | number) {
    const next = { ...readPrefs(), [key]: value };
    writePrefs(next);
    setPrefs(next);
  }

  return { prefs, setPref };
}
