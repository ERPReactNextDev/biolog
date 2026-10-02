"use client";

/* ============================================================================
   ADMIN — API Credentials (Feature 6)
   ----------------------------------------------------------------------------
   • List of all API keys with scopes, rate-limit, last-used, revoke button
   • Create modal: key name, scope checkboxes, rate-limit selector
   • Generated key shown ONCE with copy button
   • Revoke with confirmation
   ========================================================================== */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ClipboardCopy,
  KeyRound,
  Loader2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
  AlertTriangle,
  Clock,
  Zap,
  FlaskConical,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/app/activity-planner/mint/ui";
import { MintInput, MintLabel } from "@/components/mint";

/* ─── types ────────────────────────────────────────────────────────────── */

type ApiKey = {
  id: number;
  key_name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit: number;
  revoked: boolean;
  revoked_at: string | null;
  revoked_by: string | null;
  last_used: string | null;
  last_used_ip: string | null;
  created_by: string | null;
  created_at: string;
};

const ALL_SCOPES = [
  { value: "read:users",       label: "Read Users",        group: "Read" },
  { value: "read:tasklog",     label: "Read Tasklog",      group: "Read" },
  { value: "read:gps_reports", label: "Read GPS Reports",  group: "Read" },
  { value: "read:site_visits", label: "Read Site Visits",  group: "Read" },
  { value: "write:tasklog",    label: "Write Tasklog",     group: "Write" },
  { value: "admin:full",       label: "Admin Full Access", group: "Admin" },
];

const RATE_OPTS = [
  { value: 100,  label: "100 / min" },
  { value: 500,  label: "500 / min" },
  { value: 0,    label: "Unlimited" },
];

const SCOPE_TONE: Record<string, { bg: string; fg: string }> = {
  "read:users":       { bg: "#EFF6FF", fg: "#2563EB" },
  "read:tasklog":     { bg: "#EFF6FF", fg: "#2563EB" },
  "read:gps_reports": { bg: "#EFF6FF", fg: "#2563EB" },
  "read:site_visits": { bg: "#EFF6FF", fg: "#2563EB" },
  "write:tasklog":    { bg: "#FFF7ED", fg: "#C2570B" },
  "admin:full":       { bg: "#FEF2F2", fg: "#DC2626" },
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
  });
}
function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}`;
}

/* ─── Scope badge ──────────────────────────────────────────────────────── */
function ScopeBadge({ scope }: { scope: string }) {
  const t = SCOPE_TONE[scope] ?? { bg: "#F3F4F6", fg: "#6B7280" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-extrabold"
      style={{ background: t.bg, color: t.fg }}
    >
      {scope}
    </span>
  );
}

/* ─── Create modal ─────────────────────────────────────────────────────── */
function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (plaintext: string) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read:users", "read:tasklog"]);
  const [rateLimit, setRateLimit] = useState(100);
  const [busy, setBusy] = useState(false);

  const toggleScope = (s: string) =>
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );

  const submit = async () => {
    if (!name.trim()) { toast.error("Key name is required."); return; }
    if (scopes.length === 0) { toast.error("Select at least one scope."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ key_name: name.trim(), scopes, rate_limit: rateLimit }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.message || "Could not create key."); return; }
      onCreated(d.plaintext);
    } catch { toast.error("Network error."); }
    finally { setBusy(false); }
  };

  return (
    <Backdrop onClose={onClose}>
      <div className="w-full max-w-[480px] rounded-[20px] shadow-2xl overflow-hidden" style={{ background: "#fff" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: "#F3F4F6" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] flex items-center justify-center" style={{ background: "#ECFDF5", color: "#059669" }}>
              <KeyRound size={18} />
            </div>
            <div>
              <p className="text-[15px] font-black text-gray-900">New API Key</p>
              <p className="text-[11.5px] font-semibold text-gray-400">Key is shown once and cannot be recovered.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Name */}
          <div>
            <MintLabel>Key Name</MintLabel>
            <MintInput
              placeholder="e.g. Integration Test · Mobile App"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Scopes */}
          <div>
            <MintLabel>Scopes</MintLabel>
            <div className="grid grid-cols-2 gap-2">
              {ALL_SCOPES.map((s) => {
                const on = scopes.includes(s.value);
                const t = SCOPE_TONE[s.value] ?? { bg: "#F3F4F6", fg: "#6B7280" };
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => toggleScope(s.value)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-[10px] border text-left transition-all"
                    style={{
                      borderColor: on ? t.fg : "#E5E7EB",
                      background: on ? t.bg : "#FAFAFA",
                    }}
                  >
                    <span
                      className="w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-all"
                      style={{
                        background: on ? t.fg : "transparent",
                        borderColor: on ? t.fg : "#D1D5DB",
                      }}
                    >
                      {on && <Check size={10} className="text-white" strokeWidth={3} />}
                    </span>
                    <span className="text-[12px] font-extrabold" style={{ color: on ? t.fg : "#6B7280" }}>
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rate limit */}
          <div>
            <MintLabel>Rate Limit</MintLabel>
            <div className="flex gap-2">
              {RATE_OPTS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setRateLimit(o.value)}
                  className="flex-1 min-h-[40px] rounded-[10px] border text-[12px] font-extrabold transition-all"
                  style={{
                    background: rateLimit === o.value ? "#0F3D2E" : "#FAFAFA",
                    color: rateLimit === o.value ? "#fff" : "#6B7280",
                    borderColor: rateLimit === o.value ? "transparent" : "#E5E7EB",
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-[12px] border font-extrabold text-[13px] text-gray-600"
            style={{ borderColor: "#E5E7EB" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="flex-1 min-h-[44px] rounded-[12px] font-extrabold text-[13px] text-white flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "#0F3D2E" }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
            Generate Key
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

/* ─── Reveal modal (shown once after key creation) ────────────────────── */
function RevealModal({ plaintext, onClose }: { plaintext: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      toast.success("Copied to clipboard.");
      setTimeout(() => setCopied(false), 2500);
    } catch { toast.error("Could not copy — select and copy manually."); }
  };

  return (
    <Backdrop onClose={() => {}}>
      <div className="w-full max-w-[460px] rounded-[20px] shadow-2xl overflow-hidden" style={{ background: "#fff" }}>
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#ECFDF5", color: "#059669" }}>
              <ShieldCheck size={18} />
            </div>
            <div>
              <p className="text-[15px] font-black text-gray-900">Your API Key</p>
              <p className="text-[11.5px] font-semibold text-gray-400">Copy it now — it won't be shown again.</p>
            </div>
          </div>

          {/* Warning banner */}
          <div className="flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 mb-4" style={{ background: "#FEF3C7" }}>
            <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: "#D97706" }} />
            <p className="text-[11.5px] font-bold leading-relaxed" style={{ color: "#92400E" }}>
              This key is stored as a hash. Once you close this dialog, the plaintext <strong>cannot be recovered</strong>. Store it in a secrets manager immediately.
            </p>
          </div>

          {/* Key display */}
          <div
            className="flex items-center gap-3 rounded-[12px] px-4 py-3 border font-mono text-[12.5px] font-bold break-all"
            style={{ background: "#F0FDF4", borderColor: "#BBF7D0", color: "#15803D" }}
          >
            <span className="flex-1">{plaintext}</span>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-green-200"
              aria-label="Copy key"
            >
              {copied ? <Check size={15} style={{ color: "#15803D" }} /> : <ClipboardCopy size={15} style={{ color: "#15803D" }} />}
            </button>
          </div>
        </div>

        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] rounded-[12px] font-extrabold text-[13px] text-white"
            style={{ background: "#0F3D2E" }}
          >
            I've saved the key — close
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

/* ─── Revoke confirmation ─────────────────────────────────────────────── */
function RevokeModal({
  keyRow,
  onClose,
  onDone,
}: {
  keyRow: ApiKey;
  onClose: () => void;
  onDone: (id: number) => void;
}) {
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/api-keys?id=${keyRow.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.message || "Could not revoke."); return; }
      toast.success(`"${keyRow.key_name}" revoked.`);
      onDone(keyRow.id);
    } catch { toast.error("Network error."); }
    finally { setBusy(false); }
  };

  return (
    <Backdrop onClose={onClose}>
      <div className="w-full max-w-[400px] rounded-[20px] shadow-2xl p-6" style={{ background: "#fff" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#FEF2F2", color: "#DC2626" }}>
            <ShieldAlert size={18} />
          </div>
          <div>
            <p className="text-[15px] font-black text-gray-900">Revoke Key?</p>
            <p className="text-[11.5px] font-semibold text-gray-400 truncate max-w-[240px]">{keyRow.key_name} · {keyRow.key_prefix}</p>
          </div>
        </div>
        <p className="text-[13px] font-semibold text-gray-600 mb-5 leading-relaxed">
          Any service using this key will immediately receive <code className="font-bold">401 Unauthorized</code>. This cannot be undone.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-[12px] border font-extrabold text-[13px] text-gray-600" style={{ borderColor: "#E5E7EB" }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={revoke}
            className="min-h-[44px] rounded-[12px] font-extrabold text-[13px] text-white flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "#DC2626" }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Revoke
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

/* ─── Backdrop ─────────────────────────────────────────────────────────── */
function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────── */
export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/admin/api-keys", { credentials: "include" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d?.message || "Could not load keys."); return; }
      if (live.current) setKeys(d.keys ?? []);
    } catch { setError("Network error."); }
    finally { if (live.current) setLoading(false); }
  }, []);

  useEffect(() => { live.current = true; load(); return () => { live.current = false; }; }, [load]);

  const onCreated = (plaintext: string) => {
    setShowCreate(false);
    setRevealKey(plaintext);
    load(); // refresh list in background
  };

  const onRevoked = (id: number) => {
    setRevokeTarget(null);
    setKeys((prev) => prev.map((k) => k.id === id ? { ...k, revoked: true, revoked_at: new Date().toISOString() } : k));
  };

  const active = keys.filter((k) => !k.revoked);
  const revoked = keys.filter((k) => k.revoked);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-black text-[var(--text)] leading-tight">API Credentials</h1>
          <p className="text-[13px] font-semibold text-[var(--text-muted)] mt-1">
            Manage keys for third-party integrations. Keys are hashed — shown only once.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/admin/api-keys/tester"
            className="flex items-center gap-2 min-h-[40px] px-4 rounded-[10px] text-[12.5px] font-extrabold border transition-all hover:bg-gray-50"
            style={{ borderColor: "#E5E7EB", color: "#374151" }}
          >
            <FlaskConical size={15} /> Test API
          </a>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 min-h-[40px] px-4 rounded-[10px] text-[12.5px] font-extrabold text-white"
            style={{ background: "#0F3D2E" }}
          >
            <Plus size={15} /> Generate New Key
          </button>
        </div>
      </div>

      {/* Base URL */}
      <div
        className="flex items-center gap-3 rounded-[12px] px-4 py-3 mb-5 border"
        style={{ background: "#F0FDF4", borderColor: "#BBF7D0" }}
      >
        <Zap size={14} style={{ color: "#059669" }} className="shrink-0" />
        <p className="text-[12px] font-bold" style={{ color: "#065F46" }}>
          Base URL: <code className="font-mono">https://api.biolog.ph/v1</code>
          &nbsp;·&nbsp; Auth: <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>
        </p>
      </div>

      {loading ? (
        <Card className="p-10 flex items-center justify-center gap-3">
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--mint)" }} />
          <p className="text-[13px] font-semibold text-[var(--text-muted)]">Loading keys…</p>
        </Card>
      ) : error ? (
        <Card className="p-8 text-center">
          <AlertTriangle size={22} style={{ color: "var(--alert)" }} className="mx-auto mb-2" />
          <p className="text-[13px] font-semibold text-[var(--text-muted)]">{error}</p>
          <button type="button" onClick={load} className="mt-3 px-4 py-2 rounded-[10px] text-[12px] font-extrabold" style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}>
            Retry
          </button>
        </Card>
      ) : (
        <>
          {/* Active keys */}
          <p className="text-[10.5px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">
            Active Keys ({active.length})
          </p>
          {active.length === 0 ? (
            <Card className="p-8 text-center mb-5">
              <KeyRound size={22} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }} />
              <p className="text-[13px] font-semibold text-[var(--text-muted)]">No active API keys yet.</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3 mb-6">
              {active.map((k) => <KeyRow key={k.id} keyRow={k} onRevoke={() => setRevokeTarget(k)} />)}
            </div>
          )}

          {/* Revoked keys */}
          {revoked.length > 0 && (
            <>
              <p className="text-[10.5px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2 mt-4">
                Revoked Keys ({revoked.length})
              </p>
              <div className="flex flex-col gap-2">
                {revoked.map((k) => <KeyRow key={k.id} keyRow={k} revoked />)}
              </div>
            </>
          )}
        </>
      )}

      {/* Modals */}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={onCreated} />}
      {revealKey && <RevealModal plaintext={revealKey} onClose={() => setRevealKey(null)} />}
      {revokeTarget && <RevokeModal keyRow={revokeTarget} onClose={() => setRevokeTarget(null)} onDone={onRevoked} />}
    </div>
  );
}

/* ─── Key row card ─────────────────────────────────────────────────────── */
function KeyRow({
  keyRow,
  onRevoke,
  revoked = false,
}: {
  keyRow: ApiKey;
  onRevoke?: () => void;
  revoked?: boolean;
}) {
  return (
    <Card className={`p-4 ${revoked ? "opacity-55" : ""}`}>
      <div className="flex items-start gap-3 flex-wrap">
        {/* Icon */}
        <div
          className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
          style={{
            background: revoked ? "#F3F4F6" : "#ECFDF5",
            color: revoked ? "#9CA3AF" : "#059669",
          }}
        >
          <KeyRound size={17} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-extrabold text-[var(--text)]">{keyRow.key_name}</p>
            {revoked ? (
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-black" style={{ background: "#FEE2E2", color: "#DC2626" }}>
                Revoked
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-black" style={{ background: "#ECFDF5", color: "#059669" }}>
                Active
              </span>
            )}
          </div>

          <p className="font-mono text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
            {keyRow.key_prefix}
          </p>

          {/* Scopes */}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {keyRow.scopes.map((s) => <ScopeBadge key={s} scope={s} />)}
            {keyRow.scopes.length === 0 && (
              <span className="text-[11px] font-semibold text-[var(--text-faint)]">No scopes</span>
            )}
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--text-muted)]">
              <Zap size={11} />
              {keyRow.rate_limit === 0 ? "Unlimited" : `${keyRow.rate_limit}/min`}
            </span>
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--text-muted)]">
              <Clock size={11} />
              Created {fmtDate(keyRow.created_at)}
            </span>
            {keyRow.last_used && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--text-muted)]">
                Last used {fmtDateTime(keyRow.last_used)}
              </span>
            )}
            {revoked && keyRow.revoked_at && (
              <span className="text-[11px] font-semibold" style={{ color: "#DC2626" }}>
                Revoked {fmtDate(keyRow.revoked_at)} by {keyRow.revoked_by ?? "admin"}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        {!revoked && onRevoke && (
          <button
            type="button"
            onClick={onRevoke}
            className="flex items-center gap-1.5 min-h-[34px] px-3 rounded-[8px] text-[12px] font-extrabold border transition-all hover:bg-red-50 active:scale-95 shrink-0"
            style={{ borderColor: "#FECACA", color: "#DC2626", background: "#FEF2F2" }}
          >
            <Trash2 size={12} /> Revoke
          </button>
        )}
      </div>
    </Card>
  );
}
