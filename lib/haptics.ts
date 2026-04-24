// lib/haptics.ts
// Haptic feedback wrapper that respects the user's preference.

import { getPreferences } from "./preferences";

export type HapticIntensity = "light" | "medium" | "heavy" | "success" | "warning" | "error";

const PATTERNS: Record<HapticIntensity, number | number[]> = {
  light:   10,
  medium:  20,
  heavy:   35,
  success: [15, 30, 15],
  warning: [25, 50, 25],
  error:   [40, 60, 40, 60, 40],
};

/**
 * Trigger haptic feedback if the user has it enabled.
 * Safe to call on every device — silently no-ops where unsupported.
 */
export function haptic(intensity: HapticIntensity = "light"): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    const prefs = getPreferences();
    if (!prefs.haptics) return;
    navigator.vibrate(PATTERNS[intensity]);
  } catch { /* silent */ }
}
