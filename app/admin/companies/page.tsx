"use client";

/* ============================================================================
   ADMIN — Multi-Company / Companies (Feature 8)
   ----------------------------------------------------------------------------
   • Grid of company cards: name, plan badge, status badge, user count
   • Add Company modal: name, plan, status, admin email
   • Edit modal (same form, pre-filled)
   • Delete with confirmation
   ========================================================================== */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Users as UsersIcon,
  X,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/app/activity-planner/mint/ui";
import { MintInput, MintLabel } from "@/components/mint";

/* ─── types ────────────────────────────────────────────────────────────── */

type Company = {
  id: number;
  name: string;
  plan: "Starter" | "Growth" | "Enterprise";
  status: "Active" | "Trial" | "Suspended";
  admin_email: string | null;
  created_at: string;
  user_count: number;
};

type CompanyForm = {
  name: string;
  plan: Company["plan"];
  status: Company["status"];
  admin_email: string;
};

/* ─── badges ───────────────────────────────────────────────────────────── */

const PLAN_TONE: Record<Company["plan"], { bg: string; fg: string }> = {
  Starter:    { bg: "#F3F4F6", fg: "#6B7280" },
  Growth:     { bg: "#EFF6FF", fg: "#2563EB" },
  Enterprise: { bg: "#F5F3FF", fg: "#7C3AED" },
};

const STATUS_TONE: Record<Company["status"], { bg: string; fg: string }> = {
  Active:    { bg: "#ECFDF5", fg: "#059669" },
  Trial:     { bg: "#FEF3C7", fg: "#D97706" },
  Suspended: { bg: "#FEF2F2", fg: "#DC2626" },
};

function PlanBadge({ plan }: { plan: Company["plan"] }) {
  const t = PLAN_TONE[plan];
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-extrabold"
      style={{ background: t.bg, color: t.fg }}>
      {plan}
    </span>
  );
}

function StatusBadge({ status }: { status: Company["status"] }) {
  const t = STATUS_TONE[status];
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold"
      style={{ background: t.bg, color: t.fg }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.fg }} />
      {status}
    </span>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function avatarColor(name: string): string {
  const p = ["#0D9668","#2563EB","#7C3AED","#DB2777","#EA580C","#0891B2","#65A30D","#DC2626"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return p[h % p.length];
}

/* ─── Backdrop ─────────────────────────────────────────────────────────── */
function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  );
}

/* ─── Company form modal ──────────────────────────────────────────────── */
function CompanyModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Company;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(initial);
  const [form, setForm] = useState<CompanyForm>({
    name: initial?.name ?? "",
    plan: initial?.plan ?? "Starter",
    status: initial?.status ?? "Active",
    admin_email: initial?.admin_email ?? "",
  });
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof CompanyForm>(k: K) =>
    (v: CompanyForm[K]) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Company name is required."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/companies", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(isEdit ? { id: initial!.id, ...form } : form),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.message || "Could not save."); return; }
      toast.success(isEdit ? "Company updated." : "Company created.");
      onSaved();
    } catch { toast.error("Network error."); }
    finally { setBusy(false); }
  };

  return (
    <Backdrop onClose={onClose}>
      <div className="w-full max-w-[460px] rounded-[20px] shadow-2xl overflow-hidden" style={{ background: "#fff" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: "#F3F4F6" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] flex items-center justify-center"
              style={{ background: "#ECFDF5", color: "#059669" }}>
              <Building2 size={18} />
            </div>
            <p className="text-[15px] font-black text-gray-900">
              {isEdit ? "Edit Company" : "New Company"}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          <div>
            <MintLabel>Company Name</MintLabel>
            <MintInput
              placeholder="e.g. Biolog Philippines"
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
            />
          </div>

          <div>
            <MintLabel>Admin Email (optional)</MintLabel>
            <MintInput
              type="email"
              placeholder="admin@company.ph"
              value={form.admin_email}
              onChange={(e) => set("admin_email")(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <MintLabel>Plan</MintLabel>
              <div className="flex flex-col gap-1.5">
                {(["Starter", "Growth", "Enterprise"] as const).map((p) => {
                  const t = PLAN_TONE[p];
                  const on = form.plan === p;
                  return (
                    <button key={p} type="button" onClick={() => set("plan")(p)}
                      className="flex items-center gap-2 px-3 py-2 rounded-[9px] border text-left transition-all text-[12px] font-extrabold"
                      style={{
                        borderColor: on ? t.fg : "#E5E7EB",
                        background: on ? t.bg : "#FAFAFA",
                        color: on ? t.fg : "#6B7280",
                      }}>
                      <span className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0"
                        style={{ borderColor: on ? t.fg : "#D1D5DB", background: on ? t.fg : "transparent" }}>
                        {on && <Check size={8} className="text-white" strokeWidth={3} />}
                      </span>
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <MintLabel>Status</MintLabel>
              <div className="flex flex-col gap-1.5">
                {(["Active", "Trial", "Suspended"] as const).map((s) => {
                  const t = STATUS_TONE[s];
                  const on = form.status === s;
                  return (
                    <button key={s} type="button" onClick={() => set("status")(s)}
                      className="flex items-center gap-2 px-3 py-2 rounded-[9px] border text-left transition-all text-[12px] font-extrabold"
                      style={{
                        borderColor: on ? t.fg : "#E5E7EB",
                        background: on ? t.bg : "#FAFAFA",
                        color: on ? t.fg : "#6B7280",
                      }}>
                      <span className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0"
                        style={{ borderColor: on ? t.fg : "#D1D5DB", background: on ? t.fg : "transparent" }}>
                        {on && <Check size={8} className="text-white" strokeWidth={3} />}
                      </span>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 min-h-[44px] rounded-[12px] border font-extrabold text-[13px] text-gray-600"
            style={{ borderColor: "#E5E7EB" }}>
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={submit}
            className="flex-1 min-h-[44px] rounded-[12px] font-extrabold text-[13px] text-white flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "#0F3D2E" }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {isEdit ? "Save Changes" : "Create Company"}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

/* ─── Delete confirm ───────────────────────────────────────────────────── */
function DeleteModal({
  company,
  onClose,
  onDone,
}: {
  company: Company;
  onClose: () => void;
  onDone: (id: number) => void;
}) {
  const [busy, setBusy] = useState(false);

  const del = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/companies?id=${company.id}`, {
        method: "DELETE", credentials: "include",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.message || "Could not delete."); return; }
      toast.success(`"${company.name}" deleted.`);
      onDone(company.id);
    } catch { toast.error("Network error."); }
    finally { setBusy(false); }
  };

  return (
    <Backdrop onClose={onClose}>
      <div className="w-full max-w-[400px] rounded-[20px] shadow-2xl p-6" style={{ background: "#fff" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#FEF2F2", color: "#DC2626" }}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-[15px] font-black text-gray-900">Delete Company?</p>
            <p className="text-[11.5px] font-semibold text-gray-500 truncate max-w-[240px]">{company.name}</p>
          </div>
        </div>
        <p className="text-[13px] font-semibold text-gray-600 mb-5 leading-relaxed">
          This removes the company record. Users assigned to this company will have their <code>company_id</code> set to <code>NULL</code> (no data is deleted).
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose}
            className="min-h-[44px] rounded-[12px] border font-extrabold text-[13px] text-gray-600"
            style={{ borderColor: "#E5E7EB" }}>
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={del}
            className="min-h-[44px] rounded-[12px] font-extrabold text-[13px] text-white flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "#DC2626" }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Delete
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

/* ─── Company card ─────────────────────────────────────────────────────── */
function CompanyCard({
  company,
  onEdit,
  onDelete,
}: {
  company: Company;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = avatarColor(company.name);
  const initial = company.name[0]?.toUpperCase() ?? "C";

  return (
    <Card className="p-5 flex flex-col gap-4">
      {/* Top row */}
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-[14px] flex items-center justify-center text-[16px] font-black text-white shrink-0"
          style={{ background: color }}
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-extrabold text-[var(--text)] leading-tight truncate">
            {company.name}
          </p>
          <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5 truncate">
            {company.admin_email ?? "No admin email"}
          </p>
        </div>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlanBadge plan={company.plan} />
        <StatusBadge status={company.status} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[10px] px-3 py-2.5" style={{ background: "var(--bg)" }}>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)] flex items-center gap-1">
            <UsersIcon size={10} /> Users
          </p>
          <p className="text-[20px] font-black text-[var(--text)] leading-tight mt-0.5">
            {company.user_count}
          </p>
        </div>
        <div className="rounded-[10px] px-3 py-2.5" style={{ background: "var(--bg)" }}>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)] flex items-center gap-1">
            <ShieldCheck size={10} /> Since
          </p>
          <p className="text-[13px] font-extrabold text-[var(--text)] leading-tight mt-0.5">
            {fmtDate(company.created_at)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-1.5 min-h-[34px] rounded-[9px] border text-[12px] font-extrabold transition-all hover:bg-gray-50"
          style={{ borderColor: "#E5E7EB", color: "#374151" }}
        >
          <Pencil size={12} /> Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center justify-center gap-1.5 min-h-[34px] w-10 rounded-[9px] border transition-all hover:bg-red-50"
          style={{ borderColor: "#FECACA", color: "#DC2626", background: "#FEF2F2" }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </Card>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────── */
export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [search, setSearch] = useState("");
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/admin/companies", { credentials: "include" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d?.message || "Could not load companies."); return; }
      if (live.current) setCompanies(d.companies ?? []);
    } catch { setError("Network error."); }
    finally { if (live.current) setLoading(false); }
  }, []);

  useEffect(() => { live.current = true; load(); return () => { live.current = false; }; }, [load]);

  const onSaved = () => { setShowAdd(false); setEditTarget(null); load(); };
  const onDeleted = (id: number) => { setDeleteTarget(null); setCompanies((p) => p.filter((c) => c.id !== id)); };

  const filtered = search.trim()
    ? companies.filter((c) =>
        [c.name, c.admin_email ?? ""].some((v) => v.toLowerCase().includes(search.toLowerCase()))
      )
    : companies;

  const totalUsers = companies.reduce((s, c) => s + c.user_count, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-black text-[var(--text)] leading-tight">Companies</h1>
          <p className="text-[13px] font-semibold text-[var(--text-muted)] mt-1">
            Multi-tenant company management. {companies.length} compan{companies.length !== 1 ? "ies" : "y"} · {totalUsers} total users.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 min-h-[40px] px-4 rounded-[10px] text-[12.5px] font-extrabold text-white"
          style={{ background: "#0F3D2E" }}
        >
          <Plus size={15} /> Add Company
        </button>
      </div>

      {/* RBAC info banner */}
      <div className="flex items-start gap-2.5 rounded-[12px] px-4 py-3 mb-5 border"
        style={{ background: "#F0FDF4", borderColor: "#BBF7D0" }}>
        <ShieldCheck size={14} style={{ color: "#059669" }} className="shrink-0 mt-0.5" />
        <p className="text-[12px] font-bold leading-relaxed" style={{ color: "#065F46" }}>
          <strong>Super Admin</strong> — sees all companies. <strong>Company Admin</strong> — sees only their own company. Data isolation enforced via <code className="font-mono">company_id</code> FK on all tables.
        </p>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[12px] border max-w-[360px]"
          style={{ background: "#F9FAFB", borderColor: "#E5E7EB" }}>
          <Building2 size={14} className="text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="bg-transparent flex-1 text-[13px] font-medium text-gray-700 placeholder:text-gray-400 outline-none"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16">
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--mint)" }} />
          <p className="text-[13px] font-semibold text-[var(--text-muted)]">Loading companies…</p>
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <AlertTriangle size={22} style={{ color: "var(--alert)" }} className="mx-auto mb-2" />
          <p className="text-[13px] font-semibold text-[var(--text-muted)]">{error}</p>
          <button type="button" onClick={load}
            className="mt-3 px-4 py-2 rounded-[10px] text-[12px] font-extrabold"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}>
            Retry
          </button>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <Building2 size={26} className="mx-auto mb-3" style={{ color: "var(--text-faint)" }} />
          <p className="text-[14px] font-black text-[var(--text)]">
            {search ? "No companies match your search." : "No companies yet."}
          </p>
          {!search && (
            <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1">
              Click <strong>Add Company</strong> to create the first tenant.
            </p>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((c) => (
            <CompanyCard
              key={c.id}
              company={c}
              onEdit={() => setEditTarget(c)}
              onDelete={() => setDeleteTarget(c)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showAdd     && <CompanyModal onClose={() => setShowAdd(false)} onSaved={onSaved} />}
      {editTarget  && <CompanyModal initial={editTarget} onClose={() => setEditTarget(null)} onSaved={onSaved} />}
      {deleteTarget && <DeleteModal company={deleteTarget} onClose={() => setDeleteTarget(null)} onDone={onDeleted} />}
    </div>
  );
}
