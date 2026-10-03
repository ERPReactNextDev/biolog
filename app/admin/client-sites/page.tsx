"use client";

/* ============================================================================
   Admin · Client Site Fences
   ----------------------------------------------------------------------------
   Where a manager sets "this client is at these coordinates, and the boundary
   is 100 m" so the attendance sheet can warn an agent who is standing too far
   away.

   Without any row here the feature is inert and the app behaves exactly as it
   did before — which is why this page opens by saying so rather than showing
   an empty table that looks broken.

   WHY PICKING A POINT ON A MAP MATTERS
   Fences are usually created by typing an address, which gives a building's
   centroid and an accuracy of tens of metres — the same error this whole
   feature exists to remove. Dropping a pin instead puts the human judgement
   where the precision is needed.
   ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Building2,
  Info,
  Loader2,
  MapPin,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Pill } from "@/app/activity-planner/mint/ui";
import { ErrorOverlay } from "@/app/activity-planner/mint/states";
import { formatPHDateTime } from "@/lib/ph-time";

const ManualLocationPicker = dynamic(() => import("@/components/manual-location-picker"), {
  ssr: false,
});

/* A fence is a name plus coordinates and a radius. Nothing else.

   The client master data — company name, contact, address, account reference
   — lives in Neon and is read from /api/fetch-account. This page deliberately
   does not duplicate any of it: a second copy of client data in Supabase would
   drift from the real one and would need keeping in sync by hand. If a client
   is renamed in Neon, the fix here is to update the fence's name to match. */

interface Site {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
  created_at: string;
}

type Draft = {
  id?: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: string;
  is_active: boolean;
};

const EMPTY: Draft = {
  name: "",
  latitude: null,
  longitude: null,
  radius_meters: "100",
  is_active: true,
};

/** The map is a picker here, not a display — no clamping, no drag limits. */
const UNCLAMPED = null;

/* Where the map opens before a point is chosen. Metro Manila, because that is
   where the agents are — an empty new fence should land somewhere they can
   recognise, not at null island in the Atlantic. */
const DEFAULT_PICK_LAT = 14.5995;
const DEFAULT_PICK_LNG = 120.9842;

export default function ClientSitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/client-sites", {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = "/Login";
        return;
      }
      if (!res.ok) throw new Error(json?.error || "Could not load client sites.");
      setSites(Array.isArray(json.sites) ? json.sites : []);
      setNotConfigured(json.reason === "not_configured");
    } catch (e: any) {
      setError(e?.message || "Could not load client sites.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("A client name is required.");
    if (draft.latitude == null || draft.longitude == null) {
      return toast.error("Pick the client location on the map, or enter coordinates.");
    }
    const radius = Number(draft.radius_meters);
    if (!Number.isFinite(radius) || radius <= 0 || radius > 5000) {
      return toast.error("The boundary must be between 1 m and 5000 m.");
    }

    setSaving(true);
    try {
      const isNew = draft.id == null;
      const res = await fetch(
        isNew ? "/api/admin/client-sites" : `/api/admin/client-sites?id=${draft.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name: draft.name.trim(),
            latitude: draft.latitude,
            longitude: draft.longitude,
            radius_meters: radius,
            is_active: draft.is_active,
          }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save.");
      toast.success(isNew ? "Client site added." : "Client site updated.");
      setDraft(null);
      setShowPicker(false);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (site: Site) => {
    if (
      !confirm(
        `Remove the fence for "${site.name}"?\n\nThe client itself is untouched — that lives in Neon. Only the boundary is deleted, and past attendance is not affected.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/client-sites?id=${site.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not remove.");
      toast.success("Fence removed.");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Could not remove.");
    }
  };

  if (error && sites.length === 0) return <ErrorOverlay message={error} onRetry={load} />;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="mint-ui mint-scope">
      {/* Head */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="text-[21px] font-black text-[var(--text)] leading-tight tracking-tight">
            Client Site Fences
          </h1>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 leading-snug">
            Map boundaries for your clients — the clients themselves live in Neon
          </p>
        </div>
        <Button
          size="sm"
          icon={<Plus size={16} />}
          onClick={() => {
            setDraft({ ...EMPTY });
            setShowPicker(false);
          }}
        >
          Add client site
        </Button>
      </div>

      {/* Explains the empty state, because an empty table here does not look
          like "not set up" — it looks like something is missing. */}
      {notConfigured && (
        <Card className="p-4 mb-4" style={{ background: "var(--amber-soft)", border: "none" }}>
          <p className="text-[12.5px] font-extrabold" style={{ color: "var(--amber-ink)" }}>
            The client-site table has not been created yet.
          </p>
          <p className="text-[12px] font-semibold mt-1 leading-relaxed" style={{ color: "var(--amber-ink)" }}>
            Run{" "}
            <code className="mint-num font-extrabold">supabase/migrations/20260106_location_accuracy.sql</code>{" "}
            in the Supabase SQL Editor. Until then every visit is unfenced and the attendance
            sheet behaves exactly as it did before.
          </p>
        </Card>
      )}

      {!notConfigured && sites.length === 0 && !draft && !loading && (
        <Card className="py-14">
          <div className="flex flex-col items-center text-center px-6">
            <div
              className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
              style={{ background: "var(--mint-soft)", color: "var(--mint)" }}
            >
              <ShieldCheck size={28} />
            </div>
            <p className="text-[15px] font-extrabold text-[var(--text)]">No fences yet</p>
            <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 max-w-[400px] leading-relaxed">
              Until you add one, every client visit is unfenced — the sheet only checks the single
              office boundary, and nothing lands on the review list. Add the clients your team
              visits regularly. You only need the name and a point on the map.
            </p>
            <Button
              className="mt-4"
              size="sm"
              icon={<Plus size={16} />}
              onClick={() => setDraft({ ...EMPTY })}
            >
              Add your first client site
            </Button>
          </div>
        </Card>
      )}

      {/* Editor */}
      {draft && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-[14px] font-extrabold text-[var(--text)]">
              {draft.id ? "Edit client site" : "New client site"}
            </p>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setShowPicker(false);
              }}
              aria-label="Cancel"
              className="w-8 h-8 rounded-[10px] flex items-center justify-center"
              style={{ background: "var(--bg)", color: "var(--text-muted)" }}
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <Field
              label="Client name"
              hint="Exactly as it appears in the sales sheet's client list. This is the only field, because everything else about the client already lives in Neon."
            >
              <input
                className={inputCls}
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Robinsons Mandaue"
              />
            </Field>

            <Field
              label="Boundary (metres)"
              hint="100 m is the default. Wider for a big site or a mall."
            >
              <input
                className={inputCls}
                type="number"
                min={1}
                max={5000}
                value={draft.radius_meters}
                onChange={(e) => set("radius_meters", e.target.value)}
              />
            </Field>

            {/* Coordinates — read-only once picked, but always visible so the
                boundary is auditable without opening the map. */}
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                Location
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="mint-num text-[12px] font-bold px-2.5 py-1.5 rounded-full"
                  style={{ background: "var(--bg)", color: "var(--text-muted)" }}
                >
                  {draft.latitude != null
                    ? `${draft.latitude.toFixed(6)}, ${draft.longitude!.toFixed(6)}`
                    : "Not set"}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<MapPin size={15} />}
                  onClick={() => setShowPicker(!showPicker)}
                >
                  {showPicker ? "Hide map" : "Pick on map"}
                </Button>
                {draft.latitude != null && (
                  <button
                    type="button"
                    onClick={() => {
                      set("latitude", null);
                      set("longitude", null);
                      setShowPicker(false);
                    }}
                    className="text-[11.5px] font-extrabold px-3 min-h-[38px] rounded-full"
                    style={{ background: "var(--bg)", color: "var(--text-muted)" }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {showPicker && (
              <div
                className="rounded-[var(--r-card)] overflow-hidden"
                style={{ border: "1px solid var(--border)" }}
              >
                <ManualLocationPicker
                  latitude={draft.latitude ?? DEFAULT_PICK_LAT}
                  longitude={draft.longitude ?? DEFAULT_PICK_LNG}
                  clampRadiusMeters={UNCLAMPED}
                  fence={{
                    centerLat: draft.latitude ?? DEFAULT_PICK_LAT,
                    centerLng: draft.longitude ?? DEFAULT_PICK_LNG,
                    radiusMeters: Number(draft.radius_meters) || 100,
                    label: draft.name || "this client",
                  }}
                  onChange={(lat, lng) => {
                    set("latitude", lat);
                    set("longitude", lng);
                  }}
                />
              </div>
            )}

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => set("is_active", e.target.checked)}
                className="w-4 h-4 accent-[var(--mint-btn)]"
              />
              <span className="text-[12.5px] font-bold text-[var(--text)]">
                Active — agents are warned when outside this boundary
              </span>
            </label>

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                icon={<Save size={16} />}
                loading={saving}
                onClick={save}
              >
                {draft.id ? "Save changes" : "Add client site"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDraft(null);
                  setShowPicker(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* List */}
      {loading && sites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--mint)" }} />
          <p className="text-[12px] font-bold" style={{ color: "var(--text-muted)" }}>
            Loading client sites…
          </p>
        </div>
      ) : sites.length > 0 ? (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {sites.map((s) => (
            <Card key={s.id} className="p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[13.5px] font-extrabold text-[var(--text)] truncate">
                      {s.name}
                    </p>
                    {!s.is_active && <Pill tone="neutral">Inactive</Pill>}
                  </div>
                  <p
                    className="mint-num text-[11px] font-bold text-[var(--text-faint)] mt-1.5"
                  >
                    {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)} · {s.radius_meters} m
                  </p>
                  <p className="text-[10px] font-semibold text-[var(--text-faint)] mt-0.5">
                    Added {formatPHDateTime(s.created_at)}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        id: s.id,
                        name: s.name,
                        latitude: Number(s.latitude),
                        longitude: Number(s.longitude),
                        radius_meters: String(s.radius_meters),
                        is_active: s.is_active,
                      })
                    }
                    className="text-[11px] font-extrabold px-2.5 min-h-[34px] rounded-full"
                    style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    aria-label={`Remove ${s.name}`}
                    className="w-9 h-9 rounded-[10px] flex items-center justify-center"
                    style={{ background: "var(--bg)", color: "var(--alert-ink)" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {!draft && sites.length > 0 && (
        <div
          className="text-[11.5px] font-semibold text-[var(--text-faint)] mt-4 space-y-1.5"
        >
          <p className="flex items-start gap-1.5">
            <Building2 size={13} className="mt-0.5 shrink-0" />
            This page does not list your clients. It lists the boundaries you have set for them —
            the client names themselves live in Neon and are read from there.
          </p>
          <p className="flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 shrink-0" />
            The name must match what agents pick in the sales sheet, case-insensitively and
            ignoring extra spaces. If a client is renamed in Neon, update the name here too —
            until then its visits simply go unfenced, exactly as they did before this feature.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Small field wrapper ──────────────────────────────────────────────────── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
        {label}
      </p>
      {children}
      {hint && (
        <p className="text-[11px] font-semibold text-[var(--text-faint)] mt-1 leading-snug">
          {hint}
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full h-[44px] px-3.5 rounded-[14px] text-[13px] font-semibold outline-none transition-colors";