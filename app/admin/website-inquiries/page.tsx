"use client";

/* ============================================================================
   Admin · Website Inquiries
   ----------------------------------------------------------------------------
   The demo-request pipeline behind the marketing site's contact form.

   WHY IT IS A PIPELINE AND NOT A LIST
   A marketing inbox that only displays is one someone stops reading. Three
   statuses — new, contacted, closed — plus an owner and a note per lead is the
   minimum for a request to have a fate. Marking something "contacted" and
   forgetting the owner is how a warm lead quietly dies in a shared inbox.

   WHY SPAM IS A STATUS, NOT A DELETE
   Deleting on report means one bad judgement erases the evidence, and the same
   submission comes back next week. Marking it "spam" keeps the record and
   filters it out of every other view.

   ORDERING IS NEWEST-FIRST, SPAM LAST
   Spam does not deserve the top of a queue.

   SUPER ADMIN ONLY
   These rows hold a stranger's name, email, company and the contents of their
   message. That is third-party PII, not employee data, so it is not delegated
   the way team attendance is: the route uses requireSuperAdmin() and this page
   renders a clear refusal rather than an empty queue. An empty queue is
   indistinguishable from "no leads yet", which would be a lie.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Inbox,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Pill } from "@/app/activity-planner/mint/ui";
import { ErrorOverlay } from "@/app/activity-planner/mint/states";
import { formatPHDate, formatPHDateTime } from "@/lib/ph-time";

interface Inquiry {
  id: number;
  name: string;
  email: string;
  company: string | null;
  message: string | null;
  user_range: string | null;
  status: "new" | "contacted" | "closed" | "spam";
  assigned_to: string | null;
  notes: string | null;
  source_page: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_META: Record<
  Inquiry["status"],
  { label: string; tone: "mint" | "info" | "neutral" | "alert" }
> = {
  new: { label: "New", tone: "mint" },
  contacted: { label: "Contacted", tone: "info" },
  closed: { label: "Closed", tone: "neutral" },
  spam: { label: "Spam", tone: "alert" },
};

const RANGE_LABEL: Record<string, string> = {
  "1-10": "1 – 10 people",
  "11-50": "11 – 50 people",
  "51-200": "51 – 200 people",
  "200+": "200+ people",
};

export default function WebsiteInquiriesPage() {
  const [rows, setRows] = useState<Inquiry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [status, setStatus] = useState<string>("new");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/website-inquiries${status === "all" ? "" : `?status=${status}`}`,
        { credentials: "include", cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = "/Login";
        return;
      }
      /* The nav link is already hidden from non-Super-Admins, but a pasted URL
         must not land on an empty queue that looks like "no leads yet" — that is
         indistinguishable from the truth. Say what actually happened. */
      if (res.status === 403) {
        setForbidden(json?.message || "Only a Super Admin can view this.");
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(json?.error || "Could not load inquiries.");
      setForbidden("");
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setCounts(json.counts || {});
      setNotConfigured(json.reason === "not_configured");
    } catch (e: any) {
      setError(e?.message || "Could not load inquiries.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (id: number, body: Record<string, unknown>) => {
    /* Optimistic: triaging is a fast loop and waiting on a round trip per click
       makes the queue feel stuck. Rolled back on failure. */
    const before = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...body } : r)));
    setSaving((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/admin/website-inquiries?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save.");
      if (json.row) setRows((rs) => rs.map((r) => (r.id === id ? json.row : r)));
      toast.success("Saved.");
    } catch (e: any) {
      setRows(before);
      toast.error(e?.message || "Could not save.");
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  const remove = async (row: Inquiry) => {
    if (
      !confirm(
        `Delete the inquiry from ${row.name} <${row.email}>?\n\nThis cannot be undone. If it is spam, mark it as spam instead so the history is kept.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/website-inquiries?id=${row.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not delete.");
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      toast.success("Deleted.");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Could not delete.");
    }
  };

  /* Newest first, spam pushed to the bottom of its own filter. */
  const ordered = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (a.status === "spam" && b.status !== "spam") return 1;
      if (b.status === "spam" && a.status !== "spam") return -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [rows]);

  if (error && rows.length === 0) return <ErrorOverlay message={error} onRetry={load} />;

  /* Super Admin only. Rendered instead of the queue — never in addition to it,
     because a partly-visible lead list is worse than none. */
  if (forbidden) {
    return (
      <div className="mint-ui mint-scope">
        <Card className="py-16">
          <div className="flex flex-col items-center text-center px-6">
            <div
              className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
              style={{ background: "var(--amber-soft)", color: "var(--amber-ink)" }}
            >
              <Lock size={28} />
            </div>
            <p className="text-[15px] font-extrabold text-[var(--text)]">
              Super Admin only
            </p>
            <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 max-w-[420px] leading-relaxed">
              {forbidden} These are the contact submissions from the marketing
              site — they hold a visitor&apos;s name, email and message, so they
              are not delegated the way attendance records are.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mint-ui mint-scope">
      {/* Head */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="text-[21px] font-black text-[var(--text)] leading-tight tracking-tight">
            Website Inquiries
          </h1>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 leading-snug">
            Demo requests from the marketing site
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={16} />}
          onClick={load}
          loading={loading}
        >
          Refresh
        </Button>
      </div>

      {notConfigured && (
        <Card className="p-4 mb-4" style={{ background: "var(--amber-soft)", border: "none" }}>
          <p className="text-[12.5px] font-extrabold" style={{ color: "var(--amber-ink)" }}>
            Submissions are being discarded.
          </p>
          <p className="text-[12px] font-semibold mt-1 leading-relaxed" style={{ color: "var(--amber-ink)" }}>
            The contact form still shows the visitor a confirmation, but the row has nowhere to
            land. Run{" "}
            <code className="mint-num font-extrabold">supabase/migrations/20260107_website_inquiries.sql</code>{" "}
            in the Supabase SQL Editor to start capturing them.
          </p>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 mb-3">
        <FilterChip
          active={status === "new"}
          onClick={() => setStatus("new")}
          label="New"
          n={counts.new || 0}
        />
        <FilterChip
          active={status === "contacted"}
          onClick={() => setStatus("contacted")}
          label="Contacted"
          n={counts.contacted || 0}
        />
        <FilterChip
          active={status === "closed"}
          onClick={() => setStatus("closed")}
          label="Closed"
          n={counts.closed || 0}
        />
        <FilterChip
          active={status === "all"}
          onClick={() => setStatus("all")}
          label="All"
          n={counts.all || 0}
        />
        <FilterChip
          active={status === "spam"}
          onClick={() => setStatus("spam")}
          label="Spam"
          n={counts.spam || 0}
        />
      </div>

      {/* List */}
      {loading && rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--mint)" }} />
          <p className="text-[12px] font-bold" style={{ color: "var(--text-muted)" }}>
            Loading inquiries…
          </p>
        </div>
      ) : ordered.length === 0 ? (
        <Card className="py-14">
          <div className="flex flex-col items-center text-center px-6">
            <div
              className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
              style={{ background: "var(--mint-soft)", color: "var(--mint)" }}
            >
              <Inbox size={28} />
            </div>
            <p className="text-[15px] font-extrabold text-[var(--text)]">
              Nothing in {status === "all" ? "the queue" : STATUS_META[status as Inquiry["status"]]?.label || status}
            </p>
            <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 max-w-[380px] leading-relaxed">
              Requests from the marketing site's contact form land here, newest first.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {ordered.map((row) => {
            const meta = STATUS_META[row.status];
            const isOpen = expanded.has(row.id);
            const busy = saving.has(row.id);
            return (
              <Card key={row.id} className="p-3.5">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Who */}
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-extrabold text-[var(--text)] leading-tight">
                          {row.name}
                        </p>
                        <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                          {row.company || "—"}
                          {row.user_range ? ` · ${RANGE_LABEL[row.user_range] || row.user_range}` : ""}
                        </p>
                      </div>
                      <Pill tone={meta.tone}>{meta.label}</Pill>
                    </div>

                    <a
                      href={`mailto:${row.email}?subject=${encodeURIComponent("Your BIOLOG demo")}`}
                      className="inline-flex items-center gap-1.5 text-[12px] font-extrabold mt-1.5 no-underline"
                      style={{ color: "var(--mint-strong)" }}
                    >
                      <Mail size={12} />
                      {row.email}
                    </a>

                    {/* Message, truncated until expanded */}
                    {row.message && (
                      <p
                        className="text-[12px] font-semibold mt-1.5 leading-relaxed"
                        style={{
                          color: "var(--text-muted)",
                          display: "-webkit-box",
                          WebkitLineClamp: isOpen ? "unset" : 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {row.message}
                      </p>
                    )}

                    <p
                      className="mint-num text-[10.5px] font-bold text-[var(--text-faint)] mt-1.5"
                    >
                      {formatPHDateTime(row.created_at)}
                      {row.source_page ? ` · ${row.source_page}` : ""}
                      {!row.is_read ? " · unread" : ""}
                    </p>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<ChevronDown size={15} />}
                        onClick={() =>
                          setExpanded((s) => {
                            const n = new Set(s);
                            n.has(row.id) ? n.delete(row.id) : n.add(row.id);
                            return n;
                          })
                        }
                      >
                        {isOpen ? "Less" : "Triage"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Check size={15} />}
                        loading={busy}
                        onClick={() =>
                          patch(row.id, {
                            status: row.status === "closed" ? "contacted" : "closed",
                          })
                        }
                      >
                        {row.status === "closed" ? "Reopen" : "Close"}
                      </Button>
                    </div>

                    {/* Triage panel */}
                    {isOpen && (
                      <div
                        className="mt-3 pt-3 flex flex-col gap-3"
                        style={{ borderTop: "1px solid var(--border)" }}
                      >
                        <label className="block">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
                            Assigned to
                          </span>
                          <input
                            defaultValue={row.assigned_to || ""}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v !== (row.assigned_to || "")) {
                                patch(row.id, { assigned_to: v });
                              }
                            }}
                            placeholder="Who's handling this?"
                            className="w-full h-[42px] px-3 mt-1.5 rounded-[12px] text-[12.5px] font-semibold outline-none"
                            style={{
                              background: "var(--bg)",
                              border: "1px solid var(--border)",
                              color: "var(--text)",
                            }}
                          />
                        </label>

                        <label className="block">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
                            Notes
                          </span>
                          <textarea
                            defaultValue={row.notes || ""}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v !== (row.notes || "")) {
                                patch(row.id, { notes: v });
                              }
                            }}
                            rows={3}
                            placeholder="What was discussed?"
                            className="w-full px-3 py-2.5 mt-1.5 rounded-[12px] text-[12.5px] font-semibold outline-none resize-y"
                            style={{
                              background: "var(--bg)",
                              border: "1px solid var(--border)",
                              color: "var(--text)",
                              lineHeight: 1.6,
                            }}
                          />
                        </label>

                        <div className="flex items-center gap-2 flex-wrap">
                          <Select
                            value={row.status}
                            onChange={(v) => patch(row.id, { status: v })}
                            options={[
                              { value: "new", label: "New" },
                              { value: "contacted", label: "Contacted" },
                              { value: "closed", label: "Closed" },
                              { value: "spam", label: "Spam" },
                            ]}
                          />
                          {!row.is_read && (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<Mail size={15} />}
                              loading={busy}
                              onClick={() => patch(row.id, { is_read: true })}
                            >
                              Mark read
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Trash2 size={15} />}
                            onClick={() => remove(row)}
                          >
                            Delete
                          </Button>
                        </div>

                        {/* Marking spam auto-marks read, because nobody is going
                            to read a spam submission — and leaving it unread
                            keeps the unread badge permanently inflated. */}
                        {row.status === "spam" && !row.is_read && (
                          <p
                            className="text-[11px] font-semibold flex items-center gap-1.5"
                            style={{ color: "var(--amber-ink)" }}
                          >
                            <AlertTriangle size={13} />
                            This one is still flagged unread.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {ordered.length > 0 && (
        <p className="text-[11.5px] font-semibold text-[var(--text-faint)] mt-4 flex items-center gap-1.5">
          <Users size={13} />
          Visitor IP addresses are stored for spam triage but are never shown here and are
          excluded from backups.
        </p>
      )}
    </div>
  );
}

/* ── Small helpers ────────────────────────────────────────────────────────── */

function FilterChip({
  active,
  onClick,
  label,
  n,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  n: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 min-h-[36px] px-3.5 rounded-full text-[12px] font-extrabold border transition-all active:scale-95"
      style={
        active
          ? { background: "var(--mint-btn)", color: "#fff", borderColor: "transparent" }
          : { background: "var(--card)", color: "var(--text-muted)", borderColor: "var(--border)" }
      }
    >
      {label}
      <span className="ml-1.5 opacity-70">{n}</span>
    </button>
  );
}

/** A native <select>, restyled. No third-party picker for four options. */
function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-[42px] px-3 rounded-[12px] text-[12.5px] font-extrabold outline-none"
      style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}