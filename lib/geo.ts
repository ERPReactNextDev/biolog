/* ============================================================================
   lib/geo.ts — location accuracy engine
   ----------------------------------------------------------------------------
   ONE PLACE that decides how a coordinate was obtained, how good it is, and
   what address it corresponds to. Both attendance sheets and the clock drawer
   go through here, so "what counts as a good fix" can never drift between
   screens.

   WHY THIS REPLACED getCurrentPosition()
   A single getCurrentPosition() resolves with the FIRST reading the radio
   stack produces. On a phone that is routinely 40–300 m out — the classic
   "GPS drift". watchPosition() keeps reporting as the chipset converges, so
   the correct answer is: listen for a while, then take the BEST reading.

   The three things that were wrong before, concretely:
     1. The first reading was accepted immediately. Now there is a minimum
        dwell (MIN_DWELL_MS) so the radio has time to improve on it.
     2. Accuracy was discarded. `coords.accuracy` is the only thing that tells
        you whether a fix can be trusted, and it was thrown away. It is now
        carried end-to-end, rendered as a badge, drawn as a circle, and stored
        on the attendance row.
     3. A poor fix looked identical to a good one. gradeAccuracy() makes the
        difference visible to the agent before they submit.

   PROVIDER NOTE (read before swapping Nominatim out)
   Nominatim's public instance is free but its usage policy forbids heavy and
   commercial use, and it rate-limits aggressively. Swapping it for Google or
   Mapbox needs a billed API key, so this is pluggable rather than hardcoded:
   set NEXT_PUBLIC_MAPBOX_TOKEN or NEXT_PUBLIC_GOOGLE_GEOCODING_KEY and that
   provider is used automatically. Without a key it stays on Nominatim, but
   with a real cache and a 1 req/s floor so a team of field agents does not get
   the whole install IP blocked. See reverseGeocode() below.
   ========================================================================== */

import { distanceMeters } from "./geofence";

export type FixSource = "gps" | "fallback" | "cached" | "manual";

export type AccuracyTier = "excellent" | "good" | "poor" | "unknown";

export interface GeoFix {
  lat: number;
  lng: number;
  /** Radius of the 68% confidence circle, in metres. Null when unknown. */
  accuracyM: number | null;
  altitudeM: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  timestamp: number;
  source: FixSource;
  /** True when the reading is too old to trust — a cached fix, typically. */
  stale: boolean;
}

/* ── Thresholds ──────────────────────────────────────────────────────────────
   ACCEPT_M is the point at which a fix is good enough to submit silently.
   WARN_M is where the amber warning appears. The gap between them is
   deliberate: 26–50 m is acceptable for clocking in (it is often just indoor
   GPS), but >50 m usually means the agent is indoors, in a vehicle, or the
   device fell back to a cell/Wi-Fi position — which an admin will want to see.
   -------------------------------------------------------------------------- */

export const ACCEPT_M = 25;
export const WARN_M = 50;
export const CAPTURE_WINDOW_MS = 15_000;
export const MIN_DWELL_MS = 2_500;
/** A cached fix older than this is shown but flagged "needs review". */
export const STALE_AFTER_MS = 30 * 60_000;

export interface AccuracyGrade {
  tier: AccuracyTier;
  label: string;
  /** "±18 m" */
  detail: string;
  /** Calm Mint token names — components read these, never raw hex. */
  bg: string;
  fg: string;
  /** Only `poor` warrants interrupting the agent. */
  warn: boolean;
}

const UNKNOWN_GRADE: AccuracyGrade = {
  tier: "unknown",
  label: "No GPS fix",
  detail: "—",
  bg: "var(--bg)",
  fg: "var(--text-muted)",
  warn: false,
};

/**
 * Turns `coords.accuracy` into something an agent can act on.
 *
 * Only `poor` raises the amber banner. `good` is deliberately quiet: making
 * everyone who clocks in from a basement anxious helps nobody, and 26–50 m is
 * inside the noise of most indoor positions.
 */
export function gradeAccuracy(accuracyM: number | null | undefined): AccuracyGrade {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM < 0) {
    return UNKNOWN_GRADE;
  }
  const m = Math.round(accuracyM);
  if (m <= ACCEPT_M) {
    return {
      tier: "excellent",
      label: "Excellent",
      detail: `±${m} m`,
      bg: "var(--mint-soft)",
      fg: "var(--mint-strong)",
      warn: false,
    };
  }
  if (m <= WARN_M) {
    return {
      tier: "good",
      label: "Good",
      detail: `±${m} m`,
      bg: "var(--bg)",
      fg: "var(--text-muted)",
      warn: false,
    };
  }
  return {
    tier: "poor",
    label: "Poor",
    detail: `±${m} m`,
    bg: "var(--amber-soft)",
    fg: "var(--amber-ink)",
    warn: true,
  };
}

/** The amber copy from the spec, shown verbatim when the fix is poor. */
export const POOR_ACCURACY_MESSAGE =
  "Mababa ang accuracy — lumabas sa bukas na lugar o i-set manually.";

/* ── Last known location ──────────────────────────────────────────────────── */

const LS_LAST_FIX = "biolog:geo:lastFix";
const LS_GEO_CACHE = "biolog:geo:cache:v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function safeLocal(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null; // private mode / storage disabled
  }
}

/**
 * Persists every accepted fix. When the phone is offline with no signal this
 * is what the sheet falls back to — flagged stale, never presented as live.
 */
export function saveLastKnown(fix: GeoFix): void {
  const ls = safeLocal();
  if (!ls) return;
  try {
    ls.setItem(
      LS_LAST_FIX,
      JSON.stringify({
        lat: fix.lat,
        lng: fix.lng,
        accuracyM: fix.accuracyM,
        timestamp: fix.timestamp,
        source: fix.source,
      })
    );
  } catch {
    /* quota or disabled — the fix is still usable in-memory */
  }
}

export interface CachedFix extends GeoFix {
  ageMs: number;
}

export function readLastKnown(): CachedFix | null {
  const ls = safeLocal();
  if (!ls) return null;
  try {
    const raw = ls.getItem(LS_LAST_FIX);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const lat = Number(p?.lat);
    const lng = Number(p?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const timestamp = Number(p?.timestamp) || Date.now();
    const ageMs = Date.now() - timestamp;
    return {
      lat,
      lng,
      accuracyM: typeof p?.accuracyM === "number" ? p.accuracyM : null,
      altitudeM: null,
      speedMps: null,
      headingDeg: null,
      timestamp,
      source: "cached",
      stale: ageMs > STALE_AFTER_MS || ageMs < 0,
      ageMs,
    };
  } catch {
    return null;
  }
}

/* ── captureBestPosition ──────────────────────────────────────────────────── */

export interface CaptureOptions {
  /** Total listening window. The spec calls for 15 s. */
  windowMs?: number;
  /** Ignore the first `minDwellMs` worth of readings. */
  minDwellMs?: number;
  /** Resolve early once accuracy is this good. */
  acceptM?: number;
}

export type CaptureResult =
  | { ok: true; fix: GeoFix; degraded: boolean; note?: string }
  | {
      ok: false;
      reason: "unsupported" | "denied" | "unavailable" | "empty";
      message: string;
    };

function toFix(pos: GeolocationPosition, source: FixSource, stale = false): GeoFix {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracyM:
      typeof pos.coords.accuracy === "number" && Number.isFinite(pos.coords.accuracy)
        ? pos.coords.accuracy
        : null,
    altitudeM:
      typeof pos.coords.altitude === "number" ? pos.coords.altitude : null,
    speedMps:
      typeof pos.coords.speed === "number" && Number.isFinite(pos.coords.speed)
        ? pos.coords.speed
        : null,
    headingDeg:
      typeof pos.coords.heading === "number" && Number.isFinite(pos.coords.heading)
        ? pos.coords.heading
        : null,
    timestamp: pos.timestamp || Date.now(),
    source,
    stale,
  };
}

/**
 * Single `getCurrentPosition` with permissive settings. Used as step 2 of the
 * fallback chain: if the high-accuracy watch never produced anything, a coarse
 * network-derived fix still beats a dead clock-in screen.
 */
function oneShot(timeoutMs: number): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: GeolocationPosition | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs + 500);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          clearTimeout(timer);
          done(p);
        },
        () => {
          clearTimeout(timer);
          done(null);
        },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 }
      );
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}

/**
 * THE FALLBACK CHAIN, in order:
 *   1. watchPosition for up to `windowMs`, keeping the best reading.
 *      Resolves early if a good-enough fix arrives after the dwell time.
 *   2. One permissive getCurrentPosition.
 *   3. The last known location, marked stale.
 *
 * Never throws and never returns ok:false while a usable coordinate exists —
 * a field agent standing in a basement still has to be able to clock in.
 */
export async function captureBestPosition(
  opts: CaptureOptions = {}
): Promise<CaptureResult> {
  const windowMs = opts.windowMs ?? CAPTURE_WINDOW_MS;
  const minDwell = opts.minDwellMs ?? MIN_DWELL_MS;
  const acceptM = opts.acceptM ?? ACCEPT_M;

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    const cached = readLastKnown();
    if (cached) {
      return {
        ok: true,
        fix: cached,
        degraded: true,
        note: "Geolocation is not available on this device — using your last known location.",
      };
    }
    return {
      ok: false,
      reason: "unsupported",
      message: "Geolocation is not supported on this device.",
    };
  }

  /* ── Step 1: watch and keep the best ─────────────────────────────────── */
  const watched = await new Promise<{
    pos: GeolocationPosition | null;
    denied: boolean;
  }>((resolve) => {
    const started = Date.now();
    let best: GeolocationPosition | null = null;
    let watchId: number | null = null;
    let settled = false;

    const finish = (denied = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(windowTimer);
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          /* already gone */
        }
      }
      resolve({ pos: best, denied });
    };

    // Own timer: `timeout` in PositionOptions bounds the reading age, not the
    // total listening time, so it cannot be relied on to end the window.
    const windowTimer = setTimeout(() => finish(), windowMs);

    try {
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          // Keep the tightest reading, not the newest one.
          const acc = p.coords.accuracy;
          const bestAcc =
            best?.coords.accuracy != null && Number.isFinite(best.coords.accuracy)
              ? best.coords.accuracy
              : Number.POSITIVE_INFINITY;
          if (
            best === null ||
            (typeof acc === "number" && Number.isFinite(acc) && acc < bestAcc)
          ) {
            best = p;
          }
          // Don't accept the very first reading — let it improve first.
          if (
            typeof acc === "number" &&
            acc <= acceptM &&
            Date.now() - started >= minDwell
          ) {
            finish();
          }
        },
        (err) => {
          // PERMISSION_DENIED is terminal and applies to the whole chain;
          // anything else just means this attempt produced nothing.
          if (err?.code === err?.PERMISSION_DENIED) finish(true);
          else finish();
        },
        { enableHighAccuracy: true, timeout: windowMs, maximumAge: 0 }
      );
    } catch {
      finish();
    }
  });

  if (watched.pos) {
    const fix = toFix(watched.pos, "gps");
    saveLastKnown(fix);
    const poor = fix.accuracyM == null || fix.accuracyM > WARN_M;
    return {
      ok: true,
      fix,
      degraded: poor,
      ...(poor ? { note: POOR_ACCURACY_MESSAGE } : {}),
    };
  }

  if (watched.denied) {
    // A denied permission must NOT silently fall through to a stale cached
    // pin — the agent would clock in at a place they are not.
    return {
      ok: false,
      reason: "denied",
      message:
        "Location permission was denied. Allow location for this site, or set the pin manually.",
    };
  }

  /* ── Step 2: one permissive shot ────────────────────────────────────── */
  const coarse = await oneShot(10_000);
  if (coarse) {
    const fix = toFix(coarse, "fallback", true);
    saveLastKnown(fix);
    return {
      ok: true,
      fix,
      degraded: true,
      note: "Could not get a precise GPS fix — this position came from the network and needs review.",
    };
  }

  /* ── Step 3: last known ─────────────────────────────────────────────── */
  const cached = readLastKnown();
  if (cached) {
    return {
      ok: true,
      fix: cached,
      degraded: true,
      note:
        cached.ageMs > STALE_AFTER_MS
          ? `Using your last known location from ${formatAge(cached.ageMs)} — low accuracy, needs review.`
          : "Using your last known location — low accuracy, needs review.",
    };
  }

  return {
    ok: false,
    reason: "unavailable",
    message: "Location unavailable — check GPS settings, or set the address manually.",
  };
}

/** "3m ago" / "2h ago" — used in the stale-fix banner. */
export function formatAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const d = Math.floor(hours / 24);
  return `${d}d ago`;
}

/** Build a GeoFix for a coordinate the agent placed or typed by hand. */
export function manualFix(lat: number, lng: number, accuracyM: number | null = null): GeoFix {
  return {
    lat,
    lng,
    accuracyM,
    altitudeM: null,
    speedMps: null,
    headingDeg: null,
    timestamp: Date.now(),
    source: "manual",
    stale: false,
  };
}

/* ── Reverse geocoding ────────────────────────────────────────────────────── */

export type GeocoderProvider = "mapbox" | "google" | "nominatim";

export interface GeocodeResult {
  address: string | null;
  provider: GeocoderProvider | null;
  cached: boolean;
  error?: string;
}

const memCache = new Map<string, { address: string | null; provider: GeocoderProvider | null; at: number }>();

/**
 * Which provider to use.
 *
 * Google and Mapbox both send CORS headers, so they work from the browser, but
 * both bill per request and this app geocodes on every drag — that is a real
 * cost line, so the choice is an env var and not a hardcoded swap. Nominatim
 * remains the default because it needs no key.
 */
export function activeGeocoder(): GeocoderProvider {
  if (typeof process !== "undefined") {
    const forced = process.env.NEXT_PUBLIC_GEOCODER_PROVIDER?.toLowerCase();
    if (forced === "mapbox" && process.env.NEXT_PUBLIC_MAPBOX_TOKEN) return "mapbox";
    if (forced === "google" && process.env.NEXT_PUBLIC_GOOGLE_GEOCODING_KEY) {
      return "google";
    }
    if (process.env.NEXT_PUBLIC_MAPBOX_TOKEN) return "mapbox";
    if (process.env.NEXT_PUBLIC_GOOGLE_GEOCODING_KEY) return "google";
  }
  return "nominatim";
}

/** ~1.1 m of precision — coarse enough that a small drag still hits the cache. */
function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function readCache(key: string) {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const ls = safeLocal();
  if (!ls) return null;
  try {
    const all = JSON.parse(ls.getItem(LS_GEO_CACHE) || "{}");
    const e = all?.[key];
    if (e && Date.now() - Number(e.at) < CACHE_TTL_MS) {
      memCache.set(key, e);
      return e;
    }
  } catch {
    return null;
  }
  return null;
}

function writeCache(key: string, entry: { address: string | null; provider: GeocoderProvider | null; at: number }) {
  memCache.set(key, entry);
  const ls = safeLocal();
  if (!ls) return;
  try {
    const all = JSON.parse(ls.getItem(LS_GEO_CACHE) || "{}");
    // Drop expired entries opportunistically; the whole store is rewritten on
    // every miss, so an install that geocodes all day cannot grow unbounded.
    const now = Date.now();
    for (const k of Object.keys(all)) {
      if (now - Number(all[k]?.at) > CACHE_TTL_MS) delete all[k];
    }
    all[key] = entry;
    ls.setItem(LS_GEO_CACHE, JSON.stringify(all));
  } catch {
    /* quota — the in-memory cache still serves this session */
  }
}

/**
 * Nominatim's usage policy allows at most one request per second per client.
 * Every Nominatim call goes through this queue, so the app obeys the policy
 * instead of getting the install IP throttled. Paid providers skip the queue.
 */
let nominatimQueue: Promise<unknown> = Promise.resolve();
let lastNominatimAt = 0;

function nominatimFetch(url: string): Promise<Response> {
  const run = async () => {
    const wait = 1_100 - (Date.now() - lastNominatimAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    return fetch(url, { headers: { "Accept-Language": "en" } });
  };
  nominatimQueue = nominatimQueue.then(run, run);
  return nominatimQueue as Promise<Response>;
}

async function callProvider(
  provider: GeocoderProvider,
  lat: number,
  lng: number
): Promise<string | null> {
  if (provider === "mapbox") {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&limit=1&country=ph`
    );
    if (!res.ok) throw new Error(`Mapbox ${res.status}`);
    const j = await res.json();
    return j?.features?.[0]?.place_name ?? null;
  }

  if (provider === "google") {
    const key = process.env.NEXT_PUBLIC_GOOGLE_GEOCODING_KEY;
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`
    );
    if (!res.ok) throw new Error(`Google ${res.status}`);
    const j = await res.json();
    if (j?.status !== "OK") throw new Error(`Google ${j?.status}`);
    return j?.results?.[0]?.formatted_address ?? null;
  }

  const res = await nominatimFetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`
  );
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const j = await res.json();
  return j?.display_name ?? null;
}

/**
 * Reverse geocodes and caches.
 *
 * Always resolves — a failed lookup returns `{ address: null }` so the caller
 * can fall back to raw coordinates instead of leaving the agent staring at an
 * empty field. Offline is handled the same way: the cache is consulted first,
 * and only a genuine miss reaches the network.
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<GeocodeResult> {
  const key = cacheKey(lat, lng);

  const hit = readCache(key);
  if (hit) {
    return { address: hit.address, provider: hit.provider, cached: true };
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      address: null,
      provider: null,
      cached: false,
      error: "Offline — no cached address for this spot.",
    };
  }

  const provider = activeGeocoder();
  try {
    const address = await callProvider(provider, lat, lng);
    writeCache(key, { address, provider, at: Date.now() });
    return { address, provider, cached: false };
  } catch (e: any) {
    // One retry against a different provider is worth it: a single geocoder
    // being down should not read as "we don't know where you are".
    const others: GeocoderProvider[] = (["mapbox", "google", "nominatim"] as const).filter(
      (p) => p !== provider && (p === "nominatim" || envKeyFor(p))
    );
    for (const alt of others) {
      try {
        const address = await callProvider(alt, lat, lng);
        writeCache(key, { address, provider: alt, at: Date.now() });
        return { address, provider: alt, cached: false };
      } catch {
        /* try the next one */
      }
    }
    return {
      address: null,
      provider: null,
      cached: false,
      error: e?.message || "Look-up failed.",
    };
  }
}

function envKeyFor(p: GeocoderProvider): boolean {
  if (p === "mapbox") return !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (p === "google") return !!process.env.NEXT_PUBLIC_GOOGLE_GEOCODING_KEY;
  return true;
}

/** "Latitude: 14.599512, Longitude: 120.984221" — the last-resort label. */
export function coordsLabel(lat: number, lng: number): string {
  return `Latitude: ${lat.toFixed(6)}, Longitude: ${lng.toFixed(6)}`;
}

/**
 * Forward geocode for the "type the address instead" step of the fallback
 * chain. Only Mapbox is wired up, because Nominatim's /search endpoint is the
 * part of its policy most likely to be throttled; without a token the caller
 * falls back to the pin drag.
 */
export async function geocodeAddress(query: string): Promise<GeoFix | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const q = query.trim();
  if (!q || !token) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&limit=1&country=ph`
    );
    if (!res.ok) return null;
    const j = await res.json();
    const c = j?.features?.[0]?.center;
    if (!Array.isArray(c)) return null;
    const fix = manualFix(Number(c[1]), Number(c[0]));
    return fix;
  } catch {
    return null;
  }
}

/* ── Map layers ───────────────────────────────────────────────────────────── */

export type MapLayer = "streets" | "satellite";

export const MAP_LAYERS: Record<
  MapLayer,
  { label: string; url: string; attribution: string; maxZoom: number }
> = {
  streets: {
    label: "Streets",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
};

/* ── Geofence evaluation ──────────────────────────────────────────────────── */

export type FenceStatus = "inside" | "outside" | "unconfigured";

export interface FenceResult {
  status: FenceStatus;
  distanceM: number | null;
  /** How far past the boundary the point sits — 0 when inside. */
  overshootM: number | null;
  radiusM: number | null;
  siteName: string | null;
  /** The spec requires a photo + remarks before an out-of-fence log is filed. */
  requiresPhoto: boolean;
  requiresRemarks: boolean;
}

/**
 * Evaluates a point against a client site.
 *
 * `isWithinGeofence` in lib/geofence.ts answers the older, boolean question
 * for the office fence. This one is shaped for the sheet: it returns the
 * distance and the overshoot so the agent can be told how far out they are,
 * and it only demands a photo + remarks when it is genuinely out.
 */
export function evaluateFence(
  lat: number,
  lng: number,
  site: {
    name?: string | null;
    latitude: number | null;
    longitude: number | null;
    radiusMeters?: number | null;
  } | null
): FenceResult {
  const base: FenceResult = {
    status: "unconfigured",
    distanceM: null,
    overshootM: null,
    radiusM: null,
    siteName: site?.name ?? null,
    requiresPhoto: false,
    requiresRemarks: false,
  };

  if (
    !site ||
    site.latitude == null ||
    site.longitude == null ||
    !Number.isFinite(site.latitude) ||
    !Number.isFinite(site.longitude)
  ) {
    return base;
  }

  const radius = Number.isFinite(site.radiusMeters) && (site.radiusMeters as number) > 0
    ? (site.radiusMeters as number)
    : 100; // spec default

  const distanceM = distanceMeters(site.latitude, site.longitude, lat, lng);
  const inside = distanceM <= radius;

  return {
    status: inside ? "inside" : "outside",
    distanceM: Math.round(distanceM),
    overshootM: inside ? 0 : Math.round(distanceM - radius),
    radiusM: radius,
    siteName: site.name ?? null,
    requiresPhoto: !inside,
    requiresRemarks: !inside,
  };
}

/* ── What gets stored on the attendance row ───────────────────────────────── */

export type GeoFlag =
  | "low_accuracy"
  | "outside_geofence"
  | "manual_override"
  | "offline_stale"
  | "network_fix";

export interface GeoAudit {
  accuracyM: number | null;
  source: FixSource | null;
  flag: GeoFlag | null;
  distanceM: number | null;
  siteName: string | null;
}

/**
 * Reduces a fix + a fence verdict to the four columns the attendance row
 * carries. Centralised so the two sheets cannot disagree about what counts as
 * a flag, and so the admin review queue can trust the column.
 */
export function geoAudit(fix: GeoFix | null, fence: FenceResult | null): GeoAudit {
  if (!fix) {
    return { accuracyM: null, source: null, flag: null, distanceM: null, siteName: null };
  }
  let flag: GeoFlag | null = null;
  if (fix.source === "manual") flag = "manual_override";
  else if (fix.source === "cached" || fix.stale) flag = "offline_stale";
  else if (fix.source === "fallback") flag = "network_fix";
  else if (fix.accuracyM != null && fix.accuracyM > WARN_M) flag = "low_accuracy";

  // Out of bounds outranks accuracy: it is the one an admin must act on.
  if (fence?.status === "outside") flag = "outside_geofence";

  return {
    accuracyM: fix.accuracyM == null ? null : Math.round(fix.accuracyM),
    source: fix.source,
    flag,
    distanceM: fence?.distanceM ?? null,
    siteName: fence?.siteName ?? null,
  };
}

/* ── Offline ──────────────────────────────────────────────────────────────── */

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}