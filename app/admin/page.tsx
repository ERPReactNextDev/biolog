"use client";

/* ============================================================================
   /admin — desktop console landing
   ----------------------------------------------------------------------------
   The mobile Super Admin dashboard (activity-planner Home -> AdminHome) and
   this page are the same component, because AdminHome is already responsive:
   stat tiles and console links reflow from 4-across to 2-across to 1-across.

   Identity comes from /api/admin/session, which is the route that enforces
   `can_review_gps` / `can_manage_users`. Anything the session can't use comes
   back 403 and we show the permission state rather than an empty shell.
   ========================================================================== */

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import AdminHome from "@/app/activity-planner/mint/admin-home";
import { Card } from "@/app/activity-planner/mint/ui";

type Who = { name: string; role: string; canReviewGps: boolean; canManageUsers: boolean };

export default function AdminDashboardPage() {
  const router = useRouter();
  const [who, setWho] = useState<Who | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/session", { credentials: "include", cache: "no-store" });
        if (res.status === 401) {
          router.replace("/Login");
          return;
        }
        if (!res.ok) {
          if (!cancelled) setDenied(true);
          return;
        }
        const d = await res.json();
        if (cancelled) return;
        setWho({
          name: d.name || d.email,
          role: d.role || "Admin",
          canReviewGps: Boolean(d.canReviewGps),
          canManageUsers: Boolean(d.canManageUsers),
        });
      } catch {
        router.replace("/Login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (denied) {
    return (
      <div className="py-10">
        <Card className="p-8 text-center max-w-md mx-auto">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: "var(--alert-soft)", color: "var(--alert-ink)" }}
          >
            <ShieldAlert size={24} />
          </div>
          <p className="text-[16px] font-black text-[var(--text)]">No console access</p>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 leading-relaxed">
            Your account doesn&apos;t have <code className="font-bold">can_review_gps</code> or{" "}
            <code className="font-bold">can_manage_users</code>. Ask an administrator to grant
            access.
          </p>
        </Card>
      </div>
    );
  }

  if (!who) return null;

  // Neither permission — don't render data-fetching children we can't feed.
  if (!who.canReviewGps && !who.canManageUsers) {
    return (
      <div className="py-10">
        <Card className="p-8 text-center max-w-md mx-auto">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: "var(--hint-bg)", color: "var(--hint-text)" }}
          >
            <ShieldAlert size={24} />
          </div>
          <p className="text-[16px] font-black text-[var(--text)]">Nothing to show yet</p>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 leading-relaxed">
            You&apos;re signed in, but no console permissions have been granted to{" "}
            <strong>{who.name}</strong>.
          </p>
        </Card>
      </div>
    );
  }

  return <AdminHome name={who.name} role={who.role} />;
}