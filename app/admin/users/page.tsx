"use client";

/* ============================================================================
   USERS — System Users
   ----------------------------------------------------------------------------
   Layout per the approved design: breadcrumb, "System Users" header, a search
   bar paired with a total-users card, and a grouped table
   (USER DETAILS · ROLE & ID · DEPARTMENT · STATUS) with per-row `…` menus.

   Reads /api/admin/users (already RBAC-guarded by lib/rbac.ts) and mutates via
   the same route, plus /api/admin/reset-password for temporary credentials.
   ========================================================================== */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  KeyRound,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { MintDrawer, MintInput, MintLabel } from "@/components/mint";
import { Button, Card, Pill } from "@/app/activity-planner/mint/ui";

/* ── Data ───────────────────────────────────────────────────────────────── */

type UserItem = {
  _id: string;
  Firstname: string;
  Lastname: string;
  Email: string;
  Role: string;
  Department: string;
  Status: string;
  Company?: string;
  /** Tenant FK. Null until an admin assigns the user to a company. */
  company_id?: number | string | null;
  ReferenceID: string;
  LoginAttempts?: number;
  LockUntil?: string | null;
  Manager?: string;
  TSM?: string;
  ContactNumber?: string;
  Location?: string;
  TargetQuota?: string;
  profilePicture?: string | null;
  /** Per-user overrides read by lib/rbac.ts. Shape varies by row. */
  permissions?: Record<string, unknown> | null;
};

/* ── Attendance access defaults ──────────────────────────────────────────────
   Mirrors lib/rbac.ts so the drawer shows what the agent will ACTUALLY get
   rather than a guess:

     can_create_sales_attendance explicitly set -> that decides
     otherwise                                   -> the sales role decides
     can_lookup_clients unset                    -> true (matches the server)

   The role fallback is duplicated because this page has no session user to hand
   to the server helper, and defaulting everything to "basic" would silently push
   a sales agent onto the wrong screen the moment an admin opened their profile. */

const SALES_ROLE_HINTS = ["territory sales associate", "tsa", "sales associate"];

function isSalesRole(role?: string | null): boolean {
  const r = (role || "").trim().replace(/\s+/g, " ").toLowerCase();
  return SALES_ROLE_HINTS.includes(r);
}

function readPerm(user: UserItem | null, key: string): boolean | undefined {
  const p = user?.permissions as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object") return undefined;
  if (!Object.prototype.hasOwnProperty.call(p, key)) return undefined;

  const v = p[key];
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return undefined;
}

function attendanceDefaults(user: UserItem | null): {
  attendanceDrawer: "basic" | "sales";
  canLookupClients: boolean;
} {
  const explicit = readPerm(user, "can_create_sales_attendance");
  const drawer = (explicit ?? isSalesRole(user?.Role)) ? "sales" : "basic";
  return { attendanceDrawer: drawer, canLookupClients: readPerm(user, "can_lookup_clients") ?? true };
}

const ROLES = [
  "Territory Sales Associate",
  "Admin / IT",
  "Manager",
  "Default User",
  "Super Admin",
];

const MAX_ATTEMPTS = 5;

/** Locked once attempts reach the threshold and the lock hasn't expired. */
function isLocked(u: UserItem): boolean {
  if ((u.LoginAttempts ?? 0) < MAX_ATTEMPTS) return false;
  if (!u.LockUntil) return true;
  const t = new Date(u.LockUntil).getTime();
  return Number.isNaN(t) ? true : t > Date.now();
}

/** ACTIVE / REVOKED / LOCKED — the wording the design uses. */
function statusOf(u: UserItem): { label: string; tone: "mint" | "alert" | "clay" } {
  if (isLocked(u)) return { label: "LOCKED", tone: "alert" };
  const s = (u.Status || "").trim().toLowerCase();
  if (s !== "active") return { label: "REVOKED", tone: "clay" };
  return { label: "ACTIVE", tone: "mint" };
}

const initials = (u: UserItem) =>
  `${u.Firstname?.[0] || ""}${u.Lastname?.[0] || ""}`.toUpperCase() || "?";

/** Role label, collapsed to the short form the design shows. */
function roleLabel(u: UserItem): string {
  const r = (u.Role || "").trim();
  if (!r) return "User";
  if (/super\s*admin/i.test(r)) return "Super Admin";
  if (/territory sales/i.test(r)) return "Territory Sales Associate";
  if (/^admin|administrator|\bit\b/i.test(r)) return "Admin / IT";
  if (/manager/i.test(r)) return "Manager";
  return "User";
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "tsa", label: "Territory Sales Assoc." },
  { key: "admin", label: "Admin / IT" },
  { key: "manager", label: "Manager" },
  { key: "default", label: "Default User" },
  { key: "locked", label: "Locked Out" },
] as const;

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<UserItem | null>(null);
  const live = useRef(true);

  /* Row menu placement.
     The users table sits inside an `overflow-x-auto` wrapper so it can scroll
     horizontally on a narrow screen. Per CSS, setting one axis to a scroll
     container makes the other axis `auto` too — so an absolutely-positioned
     dropdown inside the table is CLIPPED by that wrapper, and it also scrolls
     away with the rows. That is why the menu used to disappear.

     Fixed on <body> with coordinates measured from the trigger: it escapes the
     scroll container entirely and can be placed above the button when the row
     is near the bottom of the viewport. */
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const placeMenu = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const menuH = 96; // two MenuItems
    const width = 208; // w-52

    let left = r.right - width;
    if (left < margin) left = margin;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - width);
    }

    // Prefer below; flip above when the row sits near the bottom edge.
    let top = r.bottom + gap;
    if (top + menuH > window.innerHeight - margin) {
      const above = r.top - gap - menuH;
      top = above > margin ? above : Math.max(margin, r.bottom + gap);
    }

    setMenuPos({ left: Math.round(left), top: Math.round(top) });
  }, []);

  useEffect(() => {
    if (!menuFor) {
      setMenuPos(null);
      return;
    }
    placeMenu();
    const onScrollOrResize = () => placeMenu();
    window.addEventListener("resize", onScrollOrResize);
    // The table scrolls horizontally; the page scrolls vertically.
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [menuFor, placeMenu]);

  // Click-away. The menu is portaled, so test both nodes or every click would
  // read as "outside" and close it before the item registers.
  useEffect(() => {
    if (!menuFor) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", { credentials: "include", cache: "no-store" });
      if (res.status === 401) return setError("Your session expired. Sign in again.");
      if (res.status === 403) return setError("You do not have permission to manage users.");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data?.message || "Could not load users.");
      if (!live.current) return;
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      if (live.current) setError("Network problem. Check your connection.");
    } finally {
      if (live.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  /* Close the row menu on an outside click. */
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuFor]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      if (needle) {
        const hay = `${u.Firstname} ${u.Lastname} ${u.Email} ${u.ReferenceID} ${u.Department} ${u.Company || ""}`;
        if (!hay.toLowerCase().includes(needle)) return false;
      }
      if (filter === "all") return true;
      if (filter === "locked") return isLocked(u);
      if (filter === "tsa") return /territory sales/i.test(u.Role || "");
      if (filter === "admin") return /admin|\bit\b/i.test(u.Role || "") && !/manager/i.test(u.Role || "");
      if (filter === "manager") return /manager/i.test(u.Role || "");
      if (filter === "default") return !u.Role || /default|user/i.test(u.Role || "");
      return true;
    });
  }, [users, q, filter]);

  const lockedCount = users.filter(isLocked).length;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5">
        <span
          className="text-[12px] font-bold px-3 py-1.5 rounded-full"
          style={{ background: "var(--bg)", color: "var(--text-faint)" }}
        >
          Admin
        </span>
        <span className="text-[12.5px] font-extrabold" style={{ color: "var(--mint-strong)" }}>
          User Management
        </span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-[26px] font-black text-[var(--text)] leading-tight tracking-tight">
            System Users
          </h1>
          <p className="text-[13px] font-semibold text-[var(--text-muted)] mt-1">
            Manage user accounts, roles, and system permissions.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => load(true)}
            aria-label="Refresh users"
            className="w-11 h-11 rounded-[13px] border flex items-center justify-center transition-colors active:scale-95"
            style={{
              background: "var(--card)",
              borderColor: "var(--border)",
              color: "var(--text-muted)",
            }}
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          </button>
          <Button
            size="lg"
            icon={<Plus size={17} />}
            onClick={() => setCreating(true)}
          >
            Add New User
          </Button>
        </div>
      </div>

      {/* Search + total */}
      <div className="flex items-stretch gap-3 flex-wrap mb-5">
        <label
          className="flex items-center gap-2.5 h-[60px] px-4 rounded-[var(--r-card-lg)] border bg-[var(--card)] flex-1 min-w-[260px]"
          style={{ borderColor: "var(--border)" }}
        >
          <Search size={17} style={{ color: "var(--text-faint)" }} className="shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, ID, or department…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] font-semibold"
            style={{ color: "var(--text)" }}
          />
        </label>

        <div
          className="h-[60px] px-5 rounded-[var(--r-card-lg)] border flex items-center gap-3 bg-[var(--card)]"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="w-10 h-10 rounded-[13px] flex items-center justify-center"
            style={{ background: "var(--clay-soft)", color: "var(--clay-ink)" }}
          >
            <UsersIcon size={18} />
          </div>
          <div>
            <p className="mint-num text-[20px] font-black leading-none text-[var(--text)]">
              {users.length}
            </p>
            <p className="text-[9.5px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)] mt-0.5">
              System Users
            </p>
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n =
            f.key === "all"
              ? users.length
              : f.key === "locked"
                ? lockedCount
                : users.filter((u) => {
                    if (f.key === "tsa") return /territory sales/i.test(u.Role || "");
                    if (f.key === "admin") return /admin|\bit\b/i.test(u.Role || "") && !/manager/i.test(u.Role || "");
                    if (f.key === "manager") return /manager/i.test(u.Role || "");
                    return !u.Role || /default|user/i.test(u.Role || "");
                  }).length;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className="min-h-[40px] px-3.5 rounded-full text-[11.5px] font-extrabold border transition-all active:scale-95 flex items-center gap-1.5"
              style={{
                background: active ? "var(--mint-btn)" : "var(--card)",
                color: active ? "#fff" : "var(--text-muted)",
                borderColor: active ? "transparent" : "var(--border)",
              }}
            >
              {f.label}
              <span
                className="min-w-[18px] h-[16px] px-1 rounded-full flex items-center justify-center text-[10px] font-black"
                style={{
                  background: active ? "rgba(255,255,255,0.25)" : "var(--bg)",
                  color: active ? "#fff" : "var(--text-muted)",
                }}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <Card className="p-10 text-center">
          <RefreshCw size={22} className="animate-spin mx-auto" style={{ color: "var(--mint)" }} />
          <p className="text-[12.5px] font-bold text-[var(--text-muted)] mt-2">Loading users…</p>
        </Card>
      ) : error ? (
        <Card className="p-8 text-center">
          <p className="text-[14px] font-black text-[var(--text)]">Could not load users</p>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1">{error}</p>
          <button
            type="button"
            onClick={() => load()}
            className="mt-4 min-h-[44px] px-5 rounded-[var(--r-btn)] text-[12.5px] font-extrabold"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          >
            Try again
          </button>
        </Card>
      ) : (
        <Card className="overflow-visible">
          {/* Grouped header */}
          <div
            className="grid items-center gap-4 px-5 py-3 border-b"
            style={{ gridTemplateColumns: "minmax(200px,1.4fr) minmax(180px,1fr) minmax(160px,1fr) 120px 44px", borderColor: "var(--border)" }}
          >
            {["User Details", "Role & ID", "Department", "Status"].map((h) => (
              <span
                key={h}
                className="text-[9.5px] font-black uppercase tracking-[0.14em]"
                style={{ color: "var(--text-muted)" }}
              >
                {h}
              </span>
            ))}
            <span />
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              {filtered.length === 0 ? (
                <p className="text-center text-[12.5px] font-semibold text-[var(--text-muted)] py-12">
                  No users match this search.
                </p>
              ) : (
                filtered.map((u) => {
                  const st = statusOf(u);
                  return (
                    <div
                      key={u._id}
                      className="grid items-center gap-4 px-5 py-3 border-b transition-colors"
                      style={{
                        gridTemplateColumns:
                          "minmax(200px,1.4fr) minmax(180px,1fr) minmax(160px,1fr) 120px 44px",
                        borderColor: "var(--border)",
                      }}
                    >
                      {/* User */}
                      <div className="flex items-center gap-3 min-w-0">
                        {u.profilePicture ? (
                          <img
                            src={u.profilePicture}
                            alt=""
                            className="w-10 h-10 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <span
                            className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-black shrink-0"
                            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
                          >
                            {initials(u)}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="text-[13px] font-extrabold text-[var(--text)] truncate">
                            {`${u.Firstname || ""} ${u.Lastname || ""}`.trim() || "—"}
                          </p>
                          <p className="text-[11px] font-semibold text-[var(--text-muted)] truncate">
                            {u.Email || "—"}
                          </p>
                        </div>
                      </div>

                      {/* Role & ID */}
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--text)] truncate">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{
                              background: isAdminishRole(u.Role)
                                ? "var(--info)"
                                : "var(--mint)",
                            }}
                          />
                          {roleLabel(u)}
                        </p>
                        <p className="mint-num text-[11px] font-semibold text-[var(--text-faint)] truncate">
                          ID: {u.ReferenceID || "—"}
                        </p>
                      </div>

                      {/* Department */}
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--text)] truncate">
                          <Building2
                            size={12}
                            style={{ color: "var(--text-faint)" }}
                            className="shrink-0"
                          />
                          {u.Department || "—"}
                        </p>
                        {u.Company && (
                          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--text-faint)] truncate">
                            {u.Company}
                          </p>
                        )}
                      </div>

                      {/* Status */}
                      <div>
                        <Pill tone={st.tone}>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
                            {st.label}
                          </span>
                        </Pill>
                      </div>

                      {/* Row menu */}
                      <div className="relative flex justify-end">
                        <button
                          ref={menuFor === u._id ? triggerRef : undefined}
                          type="button"
                          aria-label={`Actions for ${u.Firstname}`}
                          aria-haspopup="menu"
                          aria-expanded={menuFor === u._id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuFor(menuFor === u._id ? null : u._id);
                          }}
                          className="w-11 h-11 rounded-[12px] flex items-center justify-center transition-colors"
                          style={{ color: "var(--text-faint)" }}
                        >
                          <MoreVertical size={16} />
                        </button>

                        {menuFor === u._id && menuPos && createPortal(
                          <div
                            ref={menuRef}
                            className="fixed z-[80] w-52 rounded-[14px] border overflow-hidden"
                            style={{
                              left: menuPos.left,
                              top: menuPos.top,
                              background: "var(--card)",
                              borderColor: "var(--border)",
                              boxShadow: "var(--sh-card-lg)",
                            }}
                            role="menu"
                            aria-label={`Actions for ${u.Firstname}`}
                          >
                            <MenuItem
                              icon={<Pencil size={14} />}
                              label="Edit user"
                              onClick={() => {
                                setMenuFor(null);
                                setEditing(u);
                              }}
                            />
                            <MenuItem
                              icon={<KeyRound size={14} />}
                              label="Reset password"
                              onClick={() => {
                                setMenuFor(null);
                                setResetFor(u);
                              }}
                            />
                          </div>,
                          document.body
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Card>
      )}

      <p className="text-[11.5px] font-semibold text-[var(--text-faint)] mt-3">
        {filtered.length} of {users.length} user{users.length === 1 ? "" : "s"}
        {lockedCount > 0 ? ` · ${lockedCount} locked out` : ""}
      </p>

      {/* Drawers */}
      <UserFormDrawer
        open={creating || !!editing}
        user={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          load(true);
        }}
      />

      <ResetPasswordDrawer
        user={resetFor}
        onClose={() => setResetFor(null)}
        onDone={() => {
          setResetFor(null);
          load(true);
        }}
      />
    </div>
  );
}

const isAdminishRole = (r?: string) => /super\s*admin|^admin|\bit\b/i.test(r || "");

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-[44px] px-4 flex items-center gap-2.5 text-[12.5px] font-bold text-left transition-colors"
      style={{ color: "var(--text)" }}
    >
      <span style={{ color: "var(--text-faint)" }}>{icon}</span>
      {label}
    </button>
  );
}

/* ── Add / Edit ─────────────────────────────────────────────────────────── */

function UserFormDrawer({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: UserItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    Firstname: "",
    Lastname: "",
    Email: "",
    Role: "Default User",
    Department: "",
    Company: "",
    company_id: "" as string,
    ReferenceID: "",
    Status: "Active",
    Manager: "",
    TSM: "",
    ContactNumber: "",
    Location: "",
    TargetQuota: "",
    // Attendance access. Seeded from users.permissions, falling back to the
    // role default the server would use (TSA -> sales).
    attendanceDrawer: "basic" as "basic" | "sales",
    canLookupClients: true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  /* Company options for the picker.
     The tenant assignment is the company_id FK — that is what the Companies tab
     counts and what every company_id filter reads. `Company` is a separate
     free-text field and setting it does NOT put a user in a company, which is
     why it can silently disagree with the picker. */
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([]);
  const [companiesErr, setCompaniesErr] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/admin/companies", {
          credentials: "include",
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setCompaniesErr(json?.message || "Could not load companies.");
          return;
        }
        setCompanies((json.companies ?? []).map((c: any) => ({ id: c.id, name: c.name })));
        setCompaniesErr("");
      } catch {
        if (!cancelled) setCompaniesErr("Could not load companies.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setErr("");
    if (user) {
      setF({
        Firstname: user.Firstname || "",
        Lastname: user.Lastname || "",
        Email: user.Email || "",
        Role: user.Role || "Default User",
        Department: user.Department || "",
        Company: user.Company || "",
        company_id: user.company_id != null ? String(user.company_id) : "",
        ReferenceID: user.ReferenceID || "",
        Status: user.Status || "Active",
        Manager: user.Manager || "",
        TSM: user.TSM || "",
        ContactNumber: user.ContactNumber || "",
        Location: user.Location || "",
        TargetQuota: user.TargetQuota || "",
        ...attendanceDefaults(user),
      });
    } else {
      setF({
        Firstname: "",
        Lastname: "",
        Email: "",
        Role: "Default User",
        Department: "",
        Company: "",
        company_id: "",
        ReferenceID: "",
        Status: "Active",
        Manager: "",
        TSM: "",
        ContactNumber: "",
        Location: "",
        TargetQuota: "",
        attendanceDrawer: "basic",
        canLookupClients: true,
      });
    }
  }, [open, user]);

  /* The form holds strings except the two attendance-access fields, so the setter
     is typed against the state rather than assuming `string`. */
  const set =
    <K extends keyof typeof f>(k: K) =>
    (v: (typeof f)[K]) =>
      setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (busy) return;
    setErr("");
    if (!f.Firstname.trim() || !f.Lastname.trim()) return setErr("Enter first and last name.");
    if (!/^\S+@\S+\.\S+$/.test(f.Email.trim())) return setErr("Enter a valid email address.");

    setBusy(true);
    try {
      /* The drawer choice is stored as explicit permission flags, so it
         overrides the role rather than being inferred from it. The API merges
         these into any existing users.permissions jsonb rather than replacing
         it, so unrelated flags survive the save. */
      const { attendanceDrawer, canLookupClients, ...fields } = f;
      const payload = {
        ...fields,
        permissions: {
          can_create_sales_attendance: attendanceDrawer === "sales",
          can_lookup_clients: canLookupClients,
        },
      };

      const res = await fetch("/api/admin/users", {
        method: user ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", cache: "no-store",
        // `userId` (not `id`) — the API reads that field for the row to update.
        body: JSON.stringify(user ? { ...payload, userId: user._id } : payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d?.success === false) {
        setErr(d?.message || d?.error || "Could not save that user.");
        return;
      }
      toast.success(user ? "User updated." : "User created.");
      onSaved();
    } catch {
      setErr("Network problem — nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <MintDrawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      onClose={onClose}
      title={user ? "Edit user" : "Add New User"}
      maxHeight="92vh"
      header={
        <div
          className="px-6 pt-5 pb-6 flex-shrink-0"
          style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--card) 100%)" }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-11 h-11 rounded-[15px] flex items-center justify-center shrink-0"
              style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
            >
              <ShieldCheck size={21} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[19px] font-black text-[var(--text)] leading-tight">
                {user ? "Edit user" : "Add New User"}
              </h2>
              <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1">
                {user ? "Update account details, role and permissions." : "Create an account for a new team member."}
              </p>
            </div>
          </div>
        </div>
      }
      footer={
        <div
          className="px-5 pt-3.5 pb-4 border-t flex gap-2.5 shrink-0"
          style={{
            borderColor: "var(--border)",
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <Button size="lg" variant="secondary" className="shrink-0 px-6" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="lg" full loading={busy} onClick={save} icon={busy ? undefined : <Check size={17} />}>
            {busy ? "Saving…" : user ? "Save Changes" : "Create User"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-5 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <MintInput value={f.Firstname} onChange={(e) => set("Firstname")(e.target.value)} placeholder="Juan" />
          </Field>
          <Field label="Last name">
            <MintInput value={f.Lastname} onChange={(e) => set("Lastname")(e.target.value)} placeholder="Dela Cruz" />
          </Field>
        </div>

        <Field label="Email">
          <MintInput type="email" value={f.Email} onChange={(e) => set("Email")(e.target.value)} placeholder="you@biolog.ph" />
        </Field>

        <Field label="Role">
          <select
            value={f.Role}
            onChange={(e) => set("Role")(e.target.value)}
            className="w-full min-h-[48px] px-4 rounded-[var(--r-btn)] border bg-[var(--card)] text-[13.5px] font-semibold outline-none"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Department">
          <MintInput value={f.Department} onChange={(e) => set("Department")(e.target.value)} placeholder="Sales" />
        </Field>

        {/* Tenant assignment. THIS is what puts a user under a company on the
            Companies tab — the free-text `Company` field below does not. */}
        <Field label="Company (tenant)">
          <select
            value={f.company_id}
            onChange={(e) => {
              const id = e.target.value;
              set("company_id")(id);
              // Mirror the picker's name into the legacy free-text column so the
              // two stop disagreeing on the user's row.
              if (id) {
                const picked = companies.find((c) => String(c.id) === id);
                if (picked) set("Company")(picked.name);
              }
            }}
            disabled={companies.length === 0 && !!companiesErr}
            className="w-full min-h-[48px] px-4 rounded-[var(--r-btn)] border bg-[var(--card)] text-[13.5px] font-semibold outline-none disabled:opacity-50"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
          >
            <option value="">— Not assigned —</option>
            {companies.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
          {companiesErr ? (
            <p className="text-[11px] font-semibold text-[var(--alert-ink)] mt-1.5">
              {companiesErr} Manage them under Admin → Companies.
            </p>
          ) : (
            <p className="text-[11px] font-semibold text-[var(--text-faint)] mt-1.5">
              Controls tenant isolation and the Companies tab. Leave blank to keep the user
              unassigned.
            </p>
          )}
        </Field>

        <Field label="Company (as written on the form)">
          <MintInput value={f.Company} onChange={(e) => set("Company")(e.target.value)} placeholder="Biolog Inc." />
          <p className="text-[11px] font-semibold text-[var(--text-faint)] mt-1.5">
            Free text, shown on printed forms. It does not assign a tenant.
          </p>
        </Field>

        <Field label="Reference / Employee ID">
          <MintInput value={f.ReferenceID} onChange={(e) => set("ReferenceID")(e.target.value)} placeholder="BIO-2026-0143" />
        </Field>

        <Field label="Status">
          <select
            value={f.Status}
            onChange={(e) => set("Status")(e.target.value)}
            className="w-full min-h-[48px] px-4 rounded-[var(--r-btn)] border bg-[var(--card)] text-[13.5px] font-semibold outline-none"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </Field>

        {/* ── Attendance access ────────────────────────────────────────────
            Which drawer this agent gets. Decided HERE, by permission, rather
            than inferred from their position — a Territory Sales Associate can
            be moved onto the standard drawer and vice versa. */}
        <div
          className="rounded-[var(--r-card)] p-3.5"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        >
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-1">
            Attendance access
          </p>
          <p className="text-[11px] font-semibold text-[var(--text-faint)] mb-3 leading-snug">
            Chooses which clock-in screen the agent sees. This overrides their
            role.
          </p>

          <div className="grid grid-cols-1 gap-2">
            {(
              [
                {
                  key: "basic",
                  title: "Standard attendance",
                  sub: "Photo, location and remarks only",
                },
                {
                  key: "sales",
                  title: "Sales & client visits",
                  sub: "Adds client type, account and sales remarks",
                },
              ] as const
            ).map((o) => {
              const on = f.attendanceDrawer === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set("attendanceDrawer")(o.key)}
                  className="flex items-center gap-3 w-full rounded-[14px] border-2 p-3 text-left transition-colors"
                  style={{
                    background: on ? "var(--mint-soft)" : "var(--card)",
                    borderColor: on ? "var(--mint)" : "var(--border)",
                  }}
                >
                  <span
                    className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                    style={{
                      borderColor: on ? "var(--mint)" : "var(--border-strong)",
                      background: on ? "var(--mint)" : "transparent",
                    }}
                  >
                    {on && <Check size={11} className="text-white" strokeWidth={4} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-extrabold text-[var(--text)]">
                      {o.title}
                    </span>
                    <span className="block text-[11px] font-semibold text-[var(--text-muted)]">
                      {o.sub}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Only meaningful for the sales drawer — the standard one has no
              client field at all, so the toggle would be a lie. */}
          {f.attendanceDrawer === "sales" && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-extrabold text-[var(--text)] leading-tight">
                    Allow client lookup
                  </p>
                  <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
                    Shows &ldquo;New Client&rdquo; / &ldquo;Existing Client&rdquo; and the account
                    search.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={f.canLookupClients}
                  aria-label="Allow client lookup"
                  onClick={() => set("canLookupClients")(!f.canLookupClients)}
                  className="w-[52px] h-[30px] rounded-full p-[3px] flex items-center transition-colors shrink-0"
                  style={{
                    background: f.canLookupClients ? "var(--mint-btn)" : "var(--border-strong)",
                  }}
                >
                  <span
                    className="w-6 h-6 rounded-full bg-white shadow-sm transition-transform"
                    style={{ transform: f.canLookupClients ? "translateX(22px)" : "translateX(0)" }}
                  />
                </button>
              </div>

              {!f.canLookupClients && (
                <p
                  className="text-[11px] font-semibold mt-2.5 leading-relaxed"
                  style={{ color: "var(--clay-ink)" }}
                >
                  Client type and account fields will be hidden on the agent&apos;s screen. They
                  can still log their visit and time out.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Manager">
            <MintInput value={f.Manager} onChange={(e) => set("Manager")(e.target.value)} placeholder="—" />
          </Field>
          <Field label="TSM">
            <MintInput value={f.TSM} onChange={(e) => set("TSM")(e.target.value)} placeholder="—" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact number">
            <MintInput value={f.ContactNumber} onChange={(e) => set("ContactNumber")(e.target.value)} placeholder="—" />
          </Field>
          <Field label="Target quota">
            <MintInput value={f.TargetQuota} onChange={(e) => set("TargetQuota")(e.target.value)} placeholder="—" />
          </Field>
        </div>

        <Field label="Location">
          <MintInput value={f.Location} onChange={(e) => set("Location")(e.target.value)} placeholder="—" />
        </Field>

        {err && (
          <p role="alert" className="text-[12px] font-bold" style={{ color: "var(--alert-ink)" }}>
            {err}
          </p>
        )}
      </div>
    </MintDrawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <MintLabel>{label}</MintLabel>
      {children}
    </label>
  );
}

/* ── Reset password ─────────────────────────────────────────────────────── */

function ResetPasswordDrawer({
  user,
  onClose,
  onDone,
}: {
  user: UserItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [forceChange, setForceChange] = useState(true);
  const [issued, setIssued] = useState<{ password: string; emailed: boolean } | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user) {
      setIssued(null);
      setErr("");
      setCopied(false);
      setForceChange(true);
    }
  }, [user]);

  const submit = async () => {
    if (!user || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", cache: "no-store",
        body: JSON.stringify({ userId: user._id, forceChangeOnLogin: forceChange }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d?.success === false) {
        setErr(d?.message || "Could not reset that password.");
        return;
      }
      setIssued({ password: d.tempPassword || "", emailed: Boolean(d.emailed) });
      toast.success(`Password reset for ${user.Email}.`);
      onDone();
    } catch {
      setErr("Network problem — nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!issued?.password) return;
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — select it manually.");
    }
  };

  return (
    <MintDrawer
      open={!!user}
      onOpenChange={(o) => !o && onClose()}
      onClose={onClose}
      title="Reset password"
      maxHeight="88vh"
      header={
        <div
          className="px-6 pt-5 pb-6 flex-shrink-0"
          style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--card) 100%)" }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-11 h-11 rounded-[15px] flex items-center justify-center shrink-0"
              style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
            >
              <KeyRound size={21} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[19px] font-black text-[var(--text)] leading-tight">Reset password</h2>
              <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 break-all">
                {user ? user.Email : ""}
              </p>
            </div>
          </div>
        </div>
      }
      footer={
        <div
          className="px-5 pt-3.5 pb-4 border-t shrink-0"
          style={{
            borderColor: "var(--border)",
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <Button
            size="lg"
            full
            loading={busy}
            onClick={issued ? onClose : submit}
            icon={busy ? undefined : <Check size={17} />}
          >
            {issued ? "Done" : busy ? "Resetting…" : "Generate temporary password"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-5 pb-2">
        {!issued ? (
          <>
            <p className="text-[12.5px] font-semibold text-[var(--text-muted)] leading-relaxed">
              This sets a new temporary password, clears any lockout, signs the user out of every
              device, and emails the password to them.
            </p>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <span className="relative flex items-center justify-center shrink-0 mt-px">
                <input
                  type="checkbox"
                  checked={forceChange}
                  onChange={(e) => setForceChange(e.target.checked)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className="w-5 h-5 rounded-[7px] border-2 flex items-center justify-center transition-colors"
                  style={{
                    borderColor: forceChange ? "var(--mint-btn)" : "var(--border-strong)",
                    background: forceChange ? "var(--mint-btn)" : "var(--card)",
                  }}
                >
                  {forceChange && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M20 6 9 17l-5-5"
                        stroke="white"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              </span>
              <span>
                <span className="block text-[12.5px] font-extrabold text-[var(--text)]">
                  Force password change on next login
                </span>
                <span className="block text-[11px] font-semibold text-[var(--text-muted)]">
                  They&apos;ll be asked to choose their own password after signing in.
                </span>
              </span>
            </label>

            {err && (
              <p role="alert" className="text-[12px] font-bold" style={{ color: "var(--alert-ink)" }}>
                {err}
              </p>
            )}
          </>
        ) : (
          <>
            <div
              className="rounded-[var(--r-card)] p-3.5"
              style={{ background: "var(--mint-soft)" }}
            >
              <p className="text-[10px] font-black uppercase tracking-[0.12em] mb-1.5" style={{ color: "var(--mint-strong)" }}>
                Temporary password
              </p>
              <p
                className="text-[17px] font-black tracking-[0.06em] break-all"
                style={{ color: "var(--mint-strong)", fontFamily: "ui-monospace, Menlo, monospace" }}
              >
                {issued.password}
              </p>
            </div>

            <Button size="lg" variant="secondary" full icon={copied ? <Check size={16} /> : <Copy size={16} />} onClick={copy}>
              {copied ? "Copied" : "Copy password"}
            </Button>

            <p className="text-[11.5px] font-semibold text-[var(--text-muted)] leading-relaxed">
              {issued.emailed
                ? "Emailed to the user. It is shown here only once and is never stored in plain text."
                : "The email could not be sent — share this password manually. It is shown only once."}
            </p>
          </>
        )}
      </div>
    </MintDrawer>
  );
}