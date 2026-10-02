"use client";

/* ============================================================================
   OB REQUEST — data layer
   ----------------------------------------------------------------------------
   Profile comes from /api/check-session (the session cookie), NOT from
   /api/user?id=… the way app/gps-report does it.

   That is deliberate. The auto-filled Name / Position / Department fields must
   describe the person actually signed in, and `?id=` is caller-controlled — the
   GPS page will happily render another employee's details, and copying that
   into an attendance-affecting form is how records end up filed under the wrong
   person. The server re-derives the same values from the session anyway when it
   inserts the row, so reading them from the cookie keeps display and storage
   from ever disagreeing.
   ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import type { ObRequest } from "@/lib/ob-requests";

export type ObProfile = {
  name: string;
  position: string;
  department: string;
  referenceId: string;
  email: string;
} | null;

export type ObCounts = {
  all: number;
  pending: number;
  approved: number;
  declined: number;
  late: number;
};

const EMPTY_COUNTS: ObCounts = { all: 0, pending: 0, approved: 0, declined: 0, late: 0 };

export function useObData() {
  const [profile, setProfile] = useState<ObProfile>(null);
  const [requests, setRequests] = useState<ObRequest[]>([]);
  const [counts, setCounts] = useState<ObCounts>(EMPTY_COUNTS);
  const [isReviewer, setIsReviewer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/check-session", { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Your session has expired. Please sign in again.");
      const json = await res.json();
      const u = json?.user;
      if (!u) throw new Error("Your session has expired. Please sign in again.");

      const first = (u.Firstname || "").trim();
      const last = (u.Lastname || "").trim();
      setProfile({
        name: `${first} ${last}`.trim() || u.Email || "",
        position: u.Role || "",
        department: u.Department || "",
        referenceId: u.ReferenceID || "",
        email: u.Email || "",
      });
    } catch (err: any) {
      setError(err?.message || "Could not load your profile.");
    }
  }, []);

  const loadRequests = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    try {
      const res = await fetch("/api/ob-request?scope=mine", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Could not load your OB requests.");
      }
      const json = await res.json();
      setRequests(Array.isArray(json.requests) ? json.requests : []);
      setCounts({ ...EMPTY_COUNTS, ...(json.counts || {}) });
      setIsReviewer(Boolean(json.isReviewer));
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not load your OB requests.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadProfile(), loadRequests(true)]);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile, loadRequests]);

  const refresh = useCallback(async () => {
    await Promise.all([loadProfile(), loadRequests(true)]);
  }, [loadProfile, loadRequests]);

  const latest = requests[0] ?? null;

  return {
    profile,
    requests,
    counts,
    isReviewer,
    latest,
    loading,
    refreshing,
    error,
    refresh,
  };
}

/* ── Submission ─────────────────────────────────────────────────────────── */

export type ObSubmitInput = {
  photos: string[];
  destination: string;
  dateOfOB: string;
  purposeOfTravel: string;
  justification: string;
};

export async function submitObRequest(input: ObSubmitInput): Promise<ObRequest> {
  const res = await fetch("/api/ob-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `Could not submit the OB request (${res.status}).`);
  }
  return json.request as ObRequest;
}

export type ObReviewInput = {
  requestId: number | string;
  action: string;
  notes?: string;
};

export async function reviewObRequest(
  input: ObReviewInput
): Promise<{ message: string; status: string; notified: boolean }> {
  const res = await fetch("/api/ob-request/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `Could not save the review (${res.status}).`);
  }
  return json;
}