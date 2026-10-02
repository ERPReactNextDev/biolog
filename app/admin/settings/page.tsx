"use client";

/* ============================================================================
   ADMIN SETTINGS
   ----------------------------------------------------------------------------
   Card list per the approved design: icon tile, title, one-line subtitle, and
   a small action pill on the right.

   Retained as editable here (per instruction): Global Announcement and
   Attendance Rules. Both read and write /api/admin/settings, which upserts
   `system_settings` on type="global".

   No longer editable from this screen: logoUrl, themeColor and the geofence
   fields. They are still accepted by the API — say the word and they go back.
   ========================================================================== */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  History,
  Info,
  Mail,
  Megaphone,
  Save,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { MintDrawer, MintInput, MintLabel } from "@/components/mint";
import { Button, Card } from "@/app/activity-planner/mint/ui";

type Settings = {
  officeStartTime: string;
  officeEndTime: string;
  lunchStart: string;
  lunchEnd: string;
  gracePeriod: number;
  announcement: string;
};

/* ── Row ────────────────────────────────────────────────────────────────── */

function SettingRow({
  icon,
  iconBg,
  iconFg,
  title,
  subtitle,
  actionLabel,
  actionBg,
  actionFg,
  onAction,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconFg: string;
  title: string;
  subtitle: string;
  actionLabel: string;
  actionBg: string;
  actionFg: string;
  onAction: () => void;
}) {
  return (
    <Card className="p-4 flex items-center gap-4 flex-wrap">
      <div
        className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
        style={{ background: iconBg, color: iconFg }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-[200px]">
        <p className="text-[14px] font-extrabold text-[var(--text)] leading-tight">{title}</p>
        <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-0.5">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="min-h-[40px] px-4 rounded-full text-[12px] font-extrabold transition-all active:scale-95 shrink-0"
        style={{ background: actionBg, color: actionFg }}
      >
        {actionLabel}
      </button>
    </Card>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function AdminSettingsPage() {
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"" | "announcement" | "rules">("");
  const [notifyOpen, setNotifyOpen] = useState(false);
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/settings", { credentials: "include", cache: "no-store" });
      if (res.status === 401) {
        router.replace("/Login");
        return;
      }
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.message || "Could not load settings.");
        return;
      }
      if (!live.current) return;
      setS({
        officeStartTime: d.officeStartTime || "08:00",
        officeEndTime: d.officeEndTime || "17:00",
        lunchStart: d.lunchStart || "",
        lunchEnd: d.lunchEnd || "",
        gracePeriod: Number(d.gracePeriod ?? 15),
        announcement: d.announcement || "",
      });
    } catch {
      if (live.current) setError("Network problem. Check your connection.");
    } finally {
      if (live.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  /** Upserts system_settings; the API ignores fields we don't send. */
  const save = async (which: "announcement" | "rules") => {
    if (!s || saving) return;
    setSaving(which);
    try {
      const payload =
        which === "announcement"
          ? { announcement: s.announcement }
          : {
              officeStartTime: s.officeStartTime,
              officeEndTime: s.officeEndTime,
              lunchStart: s.lunchStart || null,
              lunchEnd: s.lunchEnd || null,
              gracePeriod: s.gracePeriod,
            };

      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", cache: "no-store",
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d?.success === false) {
        toast.error(d?.message || "Could not save.");
        return;
      }
      toast.success(which === "announcement" ? "Announcement published." : "Attendance rules saved.");
    } catch {
      toast.error("Network problem — nothing was saved.");
    } finally {
      setSaving("");
    }
  };

  if (loading) {
    return (
      <Card className="p-10 text-center">
        <div
          className="w-8 h-8 rounded-full mx-auto animate-spin"
          style={{ border: "3px solid var(--border)", borderTopColor: "var(--mint)" }}
        />
        <p className="text-[12.5px] font-bold text-[var(--text-muted)] mt-3">Loading settings…</p>
      </Card>
    );
  }

  if (error || !s) {
    return (
      <Card className="p-8 text-center">
        <AlertTriangle size={22} style={{ color: "var(--alert)" }} className="mx-auto" />
        <p className="text-[14px] font-black text-[var(--text)] mt-2">Could not load settings</p>
        <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-4 min-h-[44px] px-5 rounded-[var(--r-btn)] text-[12.5px] font-extrabold"
          style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
        >
          Try again
        </button>
      </Card>
    );
  }

  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) =>
    setS((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div>
      <h1 className="text-[19px] font-black text-[var(--text)] mb-4">Admin Settings</h1>

      {/* Console shortcuts */}
      <div className="flex flex-col gap-3 mb-8">
        <SettingRow
          icon={<ShieldCheck size={19} />}
          iconBg="var(--mint-soft)"
          iconFg="var(--mint-strong)"
          title="Role & Permissions (RBAC)"
          subtitle="Manage roles: Super Admin, Manager, TSA, Default"
          actionLabel="Configure"
          actionBg="var(--mint-soft)"
          actionFg="var(--mint-strong)"
          onAction={() => router.push("/admin/users")}
        />

        <SettingRow
          icon={<Mail size={19} />}
          iconBg="var(--info-soft)"
          iconFg="var(--info)"
          title="Notification Templates"
          subtitle="Approval/decline email, password reset email"
          actionLabel="Edit"
          actionBg="var(--info-soft)"
          actionFg="var(--info)"
          onAction={() => setNotifyOpen(true)}
        />

        <SettingRow
          icon={<History size={19} />}
          iconBg="var(--clay-soft)"
          iconFg="var(--clay-ink)"
          title="Audit Log"
          subtitle="Who approved/declined what, and when"
          actionLabel="View"
          actionBg="var(--clay-soft)"
          actionFg="var(--clay-ink)"
          onAction={() => router.push("/admin/audit-logs")}
        />
      </div>

      {/* ── Global Announcement ─────────────────────────────────────────── */}
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2.5">
        Communication
      </p>
      <Card className="p-5 mb-4">
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          >
            <Megaphone size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-extrabold text-[var(--text)] leading-tight">
              Global Announcement
            </p>
            <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-0.5">
              Shown on every agent&apos;s Home screen.
            </p>
          </div>
        </div>

        <MintLabel>Message</MintLabel>
        <MintInput
          textarea
          rows={3}
          value={s.announcement}
          onChange={(e) => set("announcement")(e.target.value)}
          placeholder="e.g. Take Care Everyone! — company-wide reminder"
        />

        <div className="flex justify-end mt-4">
          <Button
            size="lg"
            loading={saving === "announcement"}
            onClick={() => save("announcement")}
            icon={saving === "announcement" ? undefined : <Save size={16} />}
          >
            {saving === "announcement" ? "Publishing…" : "Publish announcement"}
          </Button>
        </div>
      </Card>

      {/* ── Attendance Rules ────────────────────────────────────────────── */}
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2.5">
        Attendance
      </p>
      <Card className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
            style={{ background: "var(--info-soft)", color: "var(--info)" }}
          >
            <CalendarClock size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-extrabold text-[var(--text)] leading-tight">
              Attendance Rules
            </p>
            <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-0.5">
              Shift window and the lateness allowance applied to every Clock In.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <MintLabel>Office start time</MintLabel>
            <MintInput
              type="time"
              value={s.officeStartTime}
              onChange={(e) => set("officeStartTime")(e.target.value)}
            />
          </label>
          <label className="block">
            <MintLabel>Office end time</MintLabel>
            <MintInput
              type="time"
              value={s.officeEndTime}
              onChange={(e) => set("officeEndTime")(e.target.value)}
            />
          </label>
          <label className="block">
            <MintLabel>Lunch start (optional)</MintLabel>
            <MintInput
              type="time"
              value={s.lunchStart}
              onChange={(e) => set("lunchStart")(e.target.value)}
            />
          </label>
          <label className="block">
            <MintLabel>Lunch end (optional)</MintLabel>
            <MintInput
              type="time"
              value={s.lunchEnd}
              onChange={(e) => set("lunchEnd")(e.target.value)}
            />
          </label>
          <label className="block">
            <MintLabel>Grace period (minutes)</MintLabel>
            <MintInput
              type="number"
              min={0}
              max={240}
              value={String(s.gracePeriod)}
              onChange={(e) => set("gracePeriod")(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
        </div>

        <p
          className="flex items-start gap-2 rounded-[var(--r-card)] px-3.5 py-2.5 mt-3 text-[11.5px] font-bold leading-relaxed"
          style={{ background: "var(--info-soft)", color: "var(--info)" }}
        >
          <Info size={14} className="shrink-0 mt-px" />
          A Clock In after {s.officeStartTime} plus {s.gracePeriod} minutes is counted as late on
          Home and in the Reports tab.
        </p>

        <div className="flex justify-end mt-4">
          <Button
            size="lg"
            loading={saving === "rules"}
            onClick={() => save("rules")}
            icon={saving === "rules" ? undefined : <Save size={16} />}
          >
            {saving === "rules" ? "Saving…" : "Save attendance rules"}
          </Button>
        </div>
      </Card>

      <NotificationTemplatesDrawer open={notifyOpen} onClose={() => setNotifyOpen(false)} />
    </div>
  );
}

/* ── Notification templates ─────────────────────────────────────────────── */

function NotificationTemplatesDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const templates = [
    {
      icon: <Bell size={17} />,
      title: "GPS report approved / declined",
      body: "Sent to the agent when an administrator reviews their submission. Includes the reviewer's notes and a timestamp for audit.",
      tone: { bg: "var(--mint-soft)", fg: "var(--mint-strong)" },
    },
    {
      icon: <ShieldCheck size={17} />,
      title: "Password reset issued",
      body: "Delivers a temporary password and states that they must change it at next sign-in.",
      tone: { bg: "var(--info-soft)", fg: "var(--info)" },
    },
    {
      icon: <AlertTriangle size={17} />,
      title: "Password changed alert",
      body: "Confirms a password change and tells the user who to contact if it wasn't them.",
      tone: { bg: "var(--clay-soft)", fg: "var(--clay-ink)" },
    },
  ];

  return (
    <MintDrawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      onClose={onClose}
      title="Notification templates"
      maxHeight="88vh"
      header={
        <div
          className="px-6 pt-5 pb-6 flex-shrink-0"
          style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--card) 100%)" }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-11 h-11 rounded-[15px] flex items-center justify-center shrink-0"
              style={{ background: "var(--info-soft)", color: "var(--info)" }}
            >
              <Mail size={21} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[19px] font-black text-[var(--text)] leading-tight">
                Notification Templates
              </h2>
              <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1">
                What the system sends, and when.
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
          <Button size="lg" variant="secondary" full onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-5 pb-2">
        {templates.map((t) => (
          <Card key={t.title} className="p-4 flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
              style={{ background: t.tone.bg, color: t.tone.fg }}
            >
              {t.icon}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-extrabold text-[var(--text)]">{t.title}</p>
              <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-1 leading-relaxed">
                {t.body}
              </p>
            </div>
          </Card>
        ))}

        <p
          className="flex items-start gap-2 rounded-[var(--r-card)] px-3.5 py-2.5 text-[11.5px] font-bold leading-relaxed"
          style={{ background: "var(--hint-bg)", color: "var(--hint-text)" }}
        >
          <Info size={14} className="shrink-0 mt-px" />
          These bodies are defined in <strong>lib/emails.ts</strong>, not stored in the database, so
          they can&apos;t be edited from here. Changing the wording needs a code change.
        </p>
      </div>
    </MintDrawer>
  );
}