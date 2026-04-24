// lib/notification-sound.ts
// Web Audio-based notification beep — no asset file required.

import { getPreferences } from "./preferences";

let cachedCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!cachedCtx) cachedCtx = new Ctor();
    return cachedCtx;
  } catch {
    return null;
  }
}

/**
 * Play a short two-tone notification chime.
 * Honors the user's notificationSound preference.
 */
export function playNotificationSound(): void {
  const prefs = getPreferences();
  if (!prefs.notificationSound) return;

  const ctx = getContext();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") ctx.resume();

    const now = ctx.currentTime;
    [
      { freq: 880, start: now,        end: now + 0.12 },
      { freq: 660, start: now + 0.13, end: now + 0.30 },
    ].forEach(({ freq, start, end }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end);
    });
  } catch { /* silent */ }
}
