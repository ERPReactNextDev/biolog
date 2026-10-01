/* ============================================================================
   Create Account — bottom drawer, Calm Mint
   ----------------------------------------------------------------------------
   Layout mirrors the approved design 1:1:
     · no Google button (the drawer is email-only)
     · no leading icons inside fields — the mockup keeps them clean
     · Password + Confirm sit SIDE BY SIDE, not stacked
     · strength meter runs inline (bars left, label right)
     · Department is a plain-looking select with no chevron
   The same <RegisterForm> renders inside /Register for shared links.

   POSTs to /api/register, which requires Firstname, Lastname, Email,
   Password, Role, Department and ReferenceID.
   ========================================================================== */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Eye, EyeOff, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { MintButton, MintDrawer, MintHint, MintLabel } from "@/components/mint";

const RULES = [
  { test: (v: string) => v.length >= 6, label: "6+ characters" },
  { test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v), label: "upper & lower case" },
  { test: (v: string) => /\d/.test(v), label: "a number" },
  { test: (v: string) => /[^A-Za-z0-9]/.test(v), label: "a symbol" },
];

const WORDS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];

function strengthOf(value: string) {
  const passed = RULES.filter((r) => r.test(value));
  const missing = RULES.filter((r) => !r.test(value)).map((r) => r.label);
  return { score: passed.length, missing, label: WORDS[passed.length] };
}

const toneOf = (score: number) =>
  score <= 1 ? "var(--alert)" : score <= 2 ? "var(--clay)" : "var(--mint)";

const FULL =
  "w-full min-h-[52px] px-4 rounded-[var(--r-btn)] border border-[var(--border-strong)] bg-[var(--card)] text-[14px] font-semibold text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none transition-colors focus:border-[var(--mint)]";

function EyeToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={show ? "Hide password" : "Show password"}
      className="absolute right-0.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-[12px] flex items-center justify-center"
      style={{ color: "var(--text-faint)" }}
    >
      {show ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );
}

/** Inline meter: four bars on the left, verdict on the right. */
function StrengthMeter({ value }: { value: string }) {
  const { score, missing, label } = useMemo(() => strengthOf(value), [value]);
  if (!value) return null;
  const tone = toneOf(score);
  return (
    <div className="flex items-center gap-2.5 mt-2.5">
      <div className="flex gap-1.5 flex-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors"
            style={{ background: i < score ? tone : "var(--border)" }}
          />
        ))}
      </div>
      <p
        className="text-[11px] font-extrabold whitespace-nowrap"
        style={{ color: score <= 1 ? "var(--alert-ink)" : score <= 2 ? "var(--clay-ink)" : "var(--mint-strong)" }}
      >
        {label}
        {missing.length > 0 ? ` — add ${missing.slice(0, 2).join(" and ")}` : ""}
      </p>
    </div>
  );
}

/* ── Form ──────────────────────────────────────────────────────────────────── */

export function RegisterForm({
  onDone,
  showFooter = true,
  onBusyChange,
  id = "register-form",
}: {
  onDone?: () => void;
  /** The drawer supplies its own sticky footer; a page renders it inline. */
  showFooter?: boolean;
  /** Lets a footer outside this <form> mirror the submit state. */
  onBusyChange?: (busy: boolean) => void;
  id?: string;
}) {
  const [Firstname, setFirstname] = useState("");
  const [Lastname, setLastname] = useState("");
  const [Email, setEmail] = useState("");
  const [Password, setPassword] = useState("");
  const [Confirm, setConfirm] = useState("");
  const [Department, setDepartment] = useState("");
  const [Company, setCompany] = useState("");
  const [ReferenceID, setReferenceID] = useState("");
  const [touchedId, setTouchedId] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* Employee ID follows the app's BIO-YYYY-NNNN format, but stays editable —
     an admin may need to issue a specific number. */
  useEffect(() => {
    if (touchedId || !Firstname || !Lastname) return;
    const year = new Date().getFullYear();
    const n = String(Math.floor(1000 + Math.random() * 9000));
    setReferenceID(`BIO-${year}-${n}`);
  }, [Firstname, Lastname, touchedId]);

  const matches = Confirm.length > 0 && Confirm === Password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");

    if (!Firstname.trim() || !Lastname.trim()) {
      setError("Enter your first and last name.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(Email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (Password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (Password !== Confirm) {
      setError("The two passwords don't match.");
      return;
    }
    if (!Department) {
      setError("Choose your department.");
      return;
    }

    setLoading(true);
    onBusyChange?.(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Firstname: Firstname.trim(),
          Lastname: Lastname.trim(),
          Email: Email.trim(),
          Password,
          // The API requires a Role; "Guest" is the default until an admin
          // promotes the account during approval.
          Role: "Guest",
          Department,
          Company,
          ReferenceID: ReferenceID.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        setError(data?.message || "We couldn't create that account. Try again.");
        return;
      }
      toast.success("Account created. An administrator will review it shortly.");
      onDone?.();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
      onBusyChange?.(false);
    }
  };

  return (
    <form id={id} onSubmit={submit} noValidate className="flex flex-col gap-4 px-5 pb-2">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" style={{ borderColor: "var(--border-strong)" }} />
        </div>
        <div className="relative flex justify-center">
          <span
            className="px-3 text-[10.5px] uppercase tracking-[0.14em] font-extrabold"
            style={{ background: "var(--card)", color: "var(--text-faint)" }}
          >
            Or sign up with email
          </span>
        </div>
      </div>

      {/* Every field is full width — two-column rows were too cramped to read
          on a 360px screen. */}
      <label className="block">
        <MintLabel>First name</MintLabel>
        <input
          className={FULL}
          value={Firstname}
          onChange={(e) => setFirstname(e.target.value)}
          placeholder="Juan"
          autoComplete="given-name"
          required
        />
      </label>

      <label className="block">
        <MintLabel>Last name</MintLabel>
        <input
          className={FULL}
          value={Lastname}
          onChange={(e) => setLastname(e.target.value)}
          placeholder="Dela Cruz"
          autoComplete="family-name"
          required
        />
      </label>

      {/* ── Email ── */}
      <label className="block">
        <MintLabel>Email address</MintLabel>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          className={FULL}
          value={Email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="juan.delacruz@company.com"
          required
        />
      </label>

      {/* ── Password ── */}
      <label className="block">
        <MintLabel>Password</MintLabel>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            className={`${FULL} pr-14`}
            value={Password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
            required
          />
          <EyeToggle show={showPw} onToggle={() => setShowPw((v) => !v)} />
        </div>
      </label>

      <StrengthMeter value={Password} />

      {/* ── Confirm ── */}
      <label className="block">
        <MintLabel>Confirm password</MintLabel>
        <div className="relative">
          <input
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            className={`${FULL} pr-14`}
            value={Confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••"
            required
          />
          <EyeToggle show={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />
        </div>
      </label>

      {matches && (
        <p
          className="flex items-center gap-1.5 text-[11.5px] font-extrabold -mt-2"
          style={{ color: "var(--mint-strong)" }}
        >
          <ShieldCheck size={13} /> Passwords match
        </p>
      )}

      {/* ── Work ── */}
      <label className="block">
        <MintLabel>Department</MintLabel>
        {/* appearance-none keeps the mockup's clean box; tapping still opens
            the native picker on mobile. */}
        <select
          className={`${FULL} appearance-none`}
          value={Department}
          onChange={(e) => setDepartment(e.target.value)}
          required
        >
          <option value="">Select…</option>
          <option value="Sales">Sales</option>
          <option value="Operations">Operations</option>
          <option value="Human Resources">Human Resources</option>
          <option value="IT">IT</option>
          <option value="Finance">Finance</option>
        </select>
      </label>

      <label className="block">
        <MintLabel className="normal-case tracking-normal">
          Company <span style={{ color: "var(--text-faint)" }}>(optional)</span>
        </MintLabel>
        <input
          className={FULL}
          value={Company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Biolog Inc."
        />
      </label>

      {/* ── Employee ID ── */}
      <label className="block">
        <MintLabel>Reference / Employee ID</MintLabel>
        <input
          className={FULL}
          value={ReferenceID}
          onChange={(e) => {
            setTouchedId(true);
            setReferenceID(e.target.value);
          }}
          placeholder="BIO-2026-0143"
        />
      </label>

      <MintHint icon={<AlertTriangle size={14} className="shrink-0 mt-px" />}>
        New accounts are pending by default. An administrator must approve your account before
        you can log in.
      </MintHint>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 text-[12px] font-bold"
          style={{ color: "var(--alert-ink)" }}
        >
          <AlertTriangle size={13} className="shrink-0 mt-px" />
          {error}
        </p>
      )}

      {showFooter && (
        <div className="flex gap-2.5 mt-1">
          <MintButton size="lg" variant="secondary" onClick={onDone} className="shrink-0 px-5">
            Cancel
          </MintButton>
          <MintButton
            type="submit"
            size="lg"
            full
            loading={loading}
            icon={loading ? undefined : <ArrowRight size={18} />}
          >
            {loading ? "Creating account…" : "Create Account"}
          </MintButton>
        </div>
      )}
    </form>
  );
}

/* ── Drawer ────────────────────────────────────────────────────────────────── */

export default function RegisterSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <MintDrawer
      open={open}
      onOpenChange={onOpenChange}
      onClose={() => onOpenChange(false)}
      title="Create Account"
      description="Sign up with email"
      maxHeight="94vh"
      header={
        <div
          className="px-6 pt-5 pb-6 flex-shrink-0"
          style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--card) 100%)" }}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-[20px] font-black text-[var(--text)] leading-tight tracking-tight">
                Create Account
              </h2>
              <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 leading-relaxed">
                Your account will be reviewed by an admin before you can log in.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 transition-colors active:scale-95"
              style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      }
      /* The submit button sits outside the <form> that MintDrawer renders in the
         body, so it is bound with the HTML `form` attribute rather than nesting. */
      footer={
        <div
          className="px-5 pt-3.5 pb-4 border-t border-[var(--border)] flex gap-2.5 shrink-0"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <MintButton
            size="lg"
            variant="secondary"
            className="shrink-0 px-6"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </MintButton>
          <MintButton
            type="submit"
            form="register-form"
            size="lg"
            full
            loading={busy}
            icon={busy ? undefined : <ArrowRight size={18} />}
          >
            {busy ? "Creating account…" : "Create Account"}
          </MintButton>
        </div>
      }
    >
      <RegisterForm
        onDone={() => onOpenChange(false)}
        showFooter={false}
        onBusyChange={setBusy}
      />
    </MintDrawer>
  );
}