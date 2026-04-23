// lib/geofence.ts
// Geofencing utility — checks if a coordinate is within a radius of a center point.

export interface GeofenceConfig {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
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
  if (!config || !config.centerLat || !config.centerLng || !config.radiusMeters) {
    return null; // not configured — allow all
  }
  const dist = distanceMeters(lat, lng, config.centerLat, config.centerLng);
  return dist <= config.radiusMeters;
}

/**
 * Fetch geofence config from admin settings.
 * Returns null if not configured.
 */
export async function fetchGeofenceConfig(): Promise<GeofenceConfig | null> {
  try {
    const res = await fetch("/api/admin/settings");
    if (!res.ok) return null;
    const data = await res.json();
    if (
      data?.geofenceLat &&
      data?.geofenceLng &&
      data?.geofenceRadius
    ) {
      return {
        centerLat:    parseFloat(data.geofenceLat),
        centerLng:    parseFloat(data.geofenceLng),
        radiusMeters: parseInt(data.geofenceRadius, 10),
      };
    }
    return null;
  } catch {
    return null;
  }
}
