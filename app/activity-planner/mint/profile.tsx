"use client";

/* ============================================================================
   PROFILE — identity card, contact details, security, settings, logout
   ========================================================================== */

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bell,
  Check,
  CircleHelp,
  CloudUpload,
  Fingerprint,
  Info,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ScanFace,
  Settings2,
  ShieldCheck,
  Smartphone,
  Clock,
} from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  Pill,
  Row,
  RowGroup,
  SectionLabel,
  Switch,
  cx,
} from "./ui";
import { useSystemSettings, type ActivityData } from "./data";
import { CameraTimerSettings } from "@/components/mint";

/** PWA install prompt capture, platform aware. */
function useInstallApp() {
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (standalone) {
      setIsInstalled(true);
      return;
    }
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    if (isIOS) setIsInstallable(true);

    const before = (e: Event) => {
      e.preventDefault();
      setIsInstallable(true);
    };
    const installed = () => {
      setIsInstalled(true);
      setIsInstallable(false);
    };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const install = async () => {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) {
      toast.info("Tap the Share button, then choose “Add to Home Screen”.", {
        duration: 7000,
      });
      return;
    }
    const evt = await new Promise<any>((resolve) => {
      const h = (e: Event) => {
        e.preventDefault();
        window.removeEventListener("beforeinstallprompt", h);
        resolve(e);
      };
      window.addEventListener("beforeinstallprompt", h);
    });
    if (!evt) {
      toast.info("Open your browser menu and choose “Install app”.");
      return;
    }
    evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
      setIsInstallable(false);
      toast.success("Biolog installed on your phone.");
    }
  };

  return { isInstallable, isInstalled, install };
}

export function ProfileScreen({ data }: { data: ActivityData }) {
  const router = useRouter();
  const settings = useSystemSettings();
  const {
    userId,
    userDetails,
    pendingCount,
    isOnline,
    isSyncing,
    syncNow,
    handleLogout,
    handleBiometricRegister,
    biometricRegistering,
    handleUpdateSecondaryEmail,
  } = data;

  const { isInstallable, isInstalled, install } = useInstallApp();
  const [notifOn, setNotifOn] = useState(true);
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [faceLoading, setFaceLoading] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    setEmailDraft(userDetails?.SecondaryEmail ?? "");
  }, [userDetails?.SecondaryEmail]);

  const initials = userDetails
    ? `${userDetails.Firstname[0] ?? ""}${userDetails.Lastname[0] ?? ""}`.toUpperCase()
    : "?";

  const saveEmail = async () => {
    setEmailSaving(true);
    try {
      await handleUpdateSecondaryEmail(emailDraft.trim());
      setEditingEmail(false);
      toast.success("Notification email updated.");
    } catch {
      toast.error("Couldn't update the email. Try again.");
    } finally {
      setEmailSaving(false);
    }
  };

  const toggleFaceVerification = async () => {
    if (!userId || faceLoading) return;
    const next = !(userDetails?.faceVerificationEnabled !== false);
    setFaceLoading(true);
    try {
      const res = await fetch("/api/profile-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, faceVerificationEnabled: next }),
      });
      if (!res.ok) throw new Error("failed");
      data.handleUpdateFaceVerification(next);
      toast.success(`Face verification ${next ? "enabled" : "disabled"}.`);
    } catch {
      toast.error("Failed to update face verification.");
    } finally {
      setFaceLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      <div className="mint-header px-4 pt-12 pb-20 flex-shrink-0 relative overflow-hidden">
        <div
          className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: "rgba(13,150,105,.05)" }}
        />

        <div className="relative z-10 flex flex-col items-center text-center">
          <Avatar
            src={userDetails?.profilePicture}
            initials={initials}
            size={84}
            className="shadow-[0_8px_24px_rgba(13,150,105,.25)]"
          />
          <h1 className="text-[20px] font-black text-[var(--text)] mt-3.5 leading-tight">
            {userDetails ? `${userDetails.Firstname} ${userDetails.Lastname}` : "—"}
          </h1>
          <p className="text-[12.5px] font-bold text-[var(--text-muted)] mt-0.5">
            {userDetails?.Role ?? "—"} {userDetails?.Department ? `· ${userDetails.Department}` : ""}
          </p>
          {userDetails?.ReferenceID && (
            <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--mint-soft)] px-3 py-1.5 text-[11px] font-extrabold text-[var(--mint-strong)]">
              <ShieldCheck size={12} /> ID: {userDetails.ReferenceID}
              {userDetails.TSM ? ` · Zone ${userDetails.TSM}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 mint-scroll px-4 -mt-14 pb-32">
        {/* Contact details — must stack ABOVE the gradient header */}
        <Card className="relative z-20 p-1 mb-4">
          <DetailRow
            icon={<Mail size={16} />}
            label="Email"
            value={userDetails?.Email || "—"}
          />
          <div className="h-px bg-[var(--border)] mx-4" />
          <DetailRow
            icon={<Phone size={16} />}
            label="Phone"
            value={userDetails?.SecondaryEmail ? "Registered" : "+63 917 000 0000"}
          />
          <div className="h-px bg-[var(--border)] mx-4" />
          <DetailRow
            icon={<Clock size={16} />}
            label="Shift"
            value={`${settings.officeStartTime} AM – ${
              Number(settings.officeEndTime.split(":")[0]) > 12
                ? settings.officeEndTime + " PM"
                : settings.officeEndTime + " PM"
            } · Mon–Sat`}
          />
        </Card>

        {/* Offline sync status */}
        {(pendingCount > 0 || !isOnline) && (
          <Card
            className="p-4 mb-4"
            style={{
              background: pendingCount > 0 ? "var(--clay-soft)" : "var(--info-soft)",
              borderColor: "transparent",
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
                style={{ background: "var(--card)" }}
              >
                <CloudUpload
                  size={19}
                  className={isSyncing ? "animate-spin" : ""}
                  style={{
                    color: pendingCount > 0 ? "var(--clay-ink)" : "var(--info)",
                  }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-[13px] font-extrabold"
                  style={{ color: pendingCount > 0 ? "var(--clay-ink)" : "var(--info)" }}
                >
                  {isSyncing
                    ? "Syncing…"
                    : pendingCount > 0
                      ? `${pendingCount} record${pendingCount !== 1 ? "s" : ""} waiting to sync`
                      : "You're offline"}
                </p>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-1 leading-relaxed">
                  {pendingCount > 0
                    ? isOnline
                      ? "Tap sync now to send these to your supervisor."
                      : "These upload automatically once you have signal."
                    : "You can still log visits — entries save to this phone."}
                </p>
                {pendingCount > 0 && isOnline && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2.5"
                    loading={isSyncing}
                    onClick={syncNow}
                  >
                    Sync now
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Account */}
        <SectionLabel className="mb-2.5">Account</SectionLabel>
        <RowGroup className="mb-4">
          <Row
            icon={<Settings2 size={18} />}
            title="Account Settings"
            subtitle="Name, role and directory access"
            onClick={() => toast.info("Contact your admin to change role or territory.")}
          />
          <Row
            icon={<Bell size={18} />}
            title="Notifications"
            subtitle="Clock-in reminders and shift alerts"
            right={
              <Switch checked={notifOn} onChange={setNotifOn} label="Notifications" />
            }
            chevron={false}
          />
          <Row
            icon={<CloudUpload size={18} />}
            title="Offline Data Sync"
            subtitle={
              pendingCount > 0 ? `${pendingCount} record${pendingCount !== 1 ? "s" : ""} pending` : "All records synced"
            }
            right={
              pendingCount > 0 ? (
                <Pill tone="clay">{pendingCount} pending</Pill>
              ) : (
                <Pill tone="mint" dot>
                  Synced
                </Pill>
              )
            }
            chevron={false}
            onClick={pendingCount > 0 && isOnline ? syncNow : undefined}
          />
        </RowGroup>

        {/* Notification email */}
        <SectionLabel className="mb-2.5">Notification Email</SectionLabel>
        <Card className="p-4 mb-4">
          {editingEmail ? (
            <>
              <input
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                placeholder="you@example.com"
                aria-label="Secondary email"
                className="w-full min-h-[48px] px-4 rounded-[var(--r-btn)] border border-[var(--border-strong)] bg-[var(--card)] text-[13.5px] font-semibold text-[var(--text)] mb-2.5"
              />
              <div className="flex gap-2">
                <Button size="md" full loading={emailSaving} onClick={saveEmail}>
                  Save
                </Button>
                <Button
                  size="md"
                  variant="secondary"
                  onClick={() => {
                    setEditingEmail(false);
                    setEmailDraft(userDetails?.SecondaryEmail ?? "");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-extrabold text-[var(--text)] truncate">
                  {userDetails?.SecondaryEmail || "Not set"}
                </p>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                  {userDetails?.SecondaryEmail
                    ? "Where shift reminders are sent"
                    : "Add one so you get reminders even without mobile data"}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Pencil size={14} />}
                onClick={() => setEditingEmail(true)}
              >
                {userDetails?.SecondaryEmail ? "Edit" : "Add"}
              </Button>
            </div>
          )}
        </Card>

        {/* Camera preferences — countdown timer */}
        <SectionLabel className="mb-2.5">Camera</SectionLabel>
        <CameraTimerSettings />

        {/* Security */}
        <SectionLabel className="mb-2.5">Security</SectionLabel>
        <RowGroup className="mb-4">
          <Row
            icon={<ScanFace size={18} />}
            title="Face Verification"
            subtitle="Require a face match when clocking in"
            right={
              <Switch
                checked={userDetails?.faceVerificationEnabled !== false}
                onChange={toggleFaceVerification}
                label="Face verification"
                disabled={faceLoading}
              />
            }
            chevron={false}
          />
          <Row
            icon={<ScanFace size={18} />}
            title="Face Registration"
            subtitle={
              userDetails?.faceDescriptors
                ? "Update your face biometric data"
                : "Register your face for verification"
            }
            right={
              userDetails?.faceDescriptors ? (
                <Pill tone="mint" dot>
                  Done
                </Pill>
              ) : undefined
            }
            onClick={() => data.setFaceRegisterOpen(true)}
          />
          <Row
            icon={<Fingerprint size={18} />}
            title="Fingerprint / Biometrics"
            subtitle={
              userDetails?.credentials?.length ? "Registered on this device" : "Use your phone's fingerprint to log in"
            }
            right={
              biometricRegistering ? (
                <Pill tone="info">Waiting…</Pill>
              ) : userDetails?.credentials?.length ? (
                <Pill tone="mint" dot>
                  On
                </Pill>
              ) : undefined
            }
            onClick={handleBiometricRegister}
          />
        </RowGroup>

        {/* Install app */}
        <SectionLabel className="mb-2.5">Install App on Phone</SectionLabel>
        <Card className="p-4 mb-4">
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
              style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
            >
              <Smartphone size={19} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-extrabold text-[var(--text)]">
                {isInstalled ? "Biolog is installed" : "Add Biolog to your home screen"}
              </p>
              <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-1 leading-relaxed">
                {isInstalled
                  ? "You can open it like a normal app, even without mobile data."
                  : "Runs full-screen and opens faster on mobile data. Use Safari on iPhone, or your browser menu on Android."}
              </p>
              {!isInstalled && isInstallable && (
                <Button size="sm" className="mt-2.5" onClick={install}>
                  Install app
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Support */}
        <SectionLabel className="mb-2.5">Support</SectionLabel>
        <RowGroup className="mb-4">
          <Row
            icon={<CircleHelp size={18} />}
            title="Help & Support"
            subtitle="Guides and contact for your supervisor"
            tone="info"
            onClick={() => toast.info("Ask your TSM to raise a ticket, or call the Biolog helpdesk.")}
          />
          <Row
            icon={<Info size={18} />}
            title="About Biolog"
            subtitle="Version and build info"
            tone="neutral"
            onClick={() => setShowAbout((v) => !v)}
            chevron={false}
            right={showAbout ? <Pill tone="mint">v1.0.0</Pill> : undefined}
          />
          {showAbout && (
            <div className="px-4 py-3 bg-[var(--card-alt)]">
              <p className="text-[12px] font-semibold text-[var(--text-muted)] leading-relaxed">
                Biolog Attendance &amp; Time Tracking. Built for Territory Sales Associates.
                Biometric clock-in with GPS verification and offline-first sync.
              </p>
            </div>
          )}
        </RowGroup>

        {/* Logout */}
        {confirmLogout ? (
          <Card className="p-4 mb-2" style={{ background: "var(--alert-soft)", borderColor: "transparent" }}>
            <p className="text-[13.5px] font-extrabold text-[var(--alert-ink)]">
              Sign out of Biolog?
            </p>
            <p className="text-[11.5px] font-semibold text-[var(--alert-ink)] mt-1 mb-3 leading-relaxed">
              {pendingCount > 0
                ? `You have ${pendingCount} unsynced record${pendingCount !== 1 ? "s" : ""}. Sync first or they'll be lost.`
                : "You'll need to sign in again to log attendance."}
            </p>
            <div className="flex gap-2">
              <Button
                size="md"
                variant="danger"
                full
                onClick={() => {
                  setConfirmLogout(false);
                  handleLogout();
                }}
              >
                Sign out
              </Button>
              <Button size="md" variant="secondary" onClick={() => setConfirmLogout(false)}>
                Stay
              </Button>
            </div>
          </Card>
        ) : (
          <Button
            full
            size="md"
            variant="danger"
            icon={<LogOut size={18} />}
            onClick={() => setConfirmLogout(true)}
          >
            Log Out
          </Button>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <div
        className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
        style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-[var(--text-faint)]">
          {label}
        </p>
        <p className="text-[13.5px] font-bold text-[var(--text)] mt-0.5 truncate">{value}</p>
      </div>
    </div>
  );
}
