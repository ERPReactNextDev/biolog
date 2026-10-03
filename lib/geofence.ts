// lib/geofence.ts
// Geofencing utility — checks if a coordinate is within a radius of a center point.
//
// TWO FENCES, NOT ONE
//   1. The OFFICE fence (system_settings.geofenceLat/Lng/Radius). Single global
//      point. Pre-existing; `isWithinGeofence` below is unchanged for it.
//   2. The CLIENT SITE fence (public.client_sites, one row per client location).
//      Added with the location-accuracy work. Optional: when no site is
//      configured for the company being visited, this resolves to null and the
//      office fence is the only one that applies — i.e. the app behaves
//      exactly as it did before, which is what an install with no rows in
//      client_sites should get.

export interface GeofenceConfig {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
}

/** A client-site fence as returned by /api/geofence/site. */
export interface SiteFence extends GeofenceConfig {
  /** The row's canonical name — used for tasklog."GeoSiteName". */
  siteName: string;
  address?: string | null;
}

/**
 * Normalises a client name into the fence lookup key: trimmed, interior
 * whitespace collapsed, lowercased.
 *
 * MUST stay byte-identical to the `name_key` generated column in
 * supabase/migrations/20260106_location_accuracy.sql, which computes
 * lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))). The column exists so
 * that a lookup is `.eq("name_key", normalizeSiteName(x))` — an index hit.
 * If the two expressions disagree the failure is SILENT: the agent gets no
 * fence, no warning, and no idea why. Change one and change the other.
 *
 * Interior whitespace is collapsed because tasklog."SiteVisitAccount" is typed
 * by hand, so "Robinsons  Mandaue" has to reach the fence registered as
 * "Robinsons Mandaue".
 */
export function normalizeSiteName(name: string): string {
  return (name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Looks up the fence for the company being visited.
 *
 * Returns null on ANY failure — no route, 404, offline, malformed body. A
 * failed lookup must never block a clock-in; the office fence still runs, and
 * if that is unconfigured too the log simply carries no site data.
 */
export async function fetchSiteFence(
  siteName: string | null | undefined
): Promise<SiteFence | null> {
  const q = normalizeSiteName(siteName || "");
  if (!q) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;

  try {
    const res = await fetch(
      `/api/geofence/site?site=${encodeURIComponent(q)}`,
      { credentials: "include", cache: "no-store" }
    );
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json?.site) return null;
    const s = json.site;
    const lat = Number(s.centerLat);
    const lng = Number(s.centerLng);
    const radius = Number(s.radiusMeters);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius)) {
      return null;
    }
    return {
      centerLat: lat,
      centerLng: lng,
      radiusMeters: radius,
      siteName: String(s.siteName ?? siteName),
      address: s.address ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Haversine formula — returns distance in meters between two coordinates.
 */
export function distanceMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns true if (lat, lng) is within the geofence.
 * Returns null if geofence is not configured (no center set).
 */
export function isWithinGeofence(
  lat: number,
  lng: number,
  config: GeofenceConfig | null
): boolean | null {
  // Number.isFinite rather than truthiness: a fence centred on 0° longitude is
  // a legitimate configuration, and `!config.centerLng` would discard it.
  if (
    !config ||
    !Number.isFinite(config.centerLat) ||
    !Number.isFinite(config.centerLng) ||
    !Number.isFinite(config.radiusMeters) ||
    config.radiusMeters <= 0
  ) {
    return null; // not configured — allow all
  }
  const dist = distanceMeters(lat, lng, config.centerLat, config.centerLng);
  return dist <= config.radiusMeters;
}

/**
 * Fetch geofence config from admin settings.
 * Returns null if not configured.
 *
 * Numbers are parsed and checked with Number.isFinite rather than tested for
 * truthiness. The old `!data?.geofenceLat` guard silently discarded a fence
 * configured at latitude 0 or longitude 0, and — worse — would have accepted
 * the string "0" as a valid radius while producing a NaN radius from a
 * malformed value, which made isWithinGeofence compare everything as false.
 */
export async function fetchGeofenceConfig(): Promise<GeofenceConfig | null> {
  try {
    const res = await fetch("/api/admin/settings", {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();

    const centerLat = Number(data?.geofenceLat);
    const centerLng = Number(data?.geofenceLng);
    const radiusMeters = Number.parseInt(String(data?.geofenceRadius ?? ""), 10);

    if (
      !Number.isFinite(centerLat) ||
      !Number.isFinite(centerLng) ||
      !Number.isFinite(radiusMeters) ||
      radiusMeters <= 0
    ) {
      return null;
    }

    return { centerLat, centerLng, radiusMeters };
  } catch {
    return null;
  }
}
