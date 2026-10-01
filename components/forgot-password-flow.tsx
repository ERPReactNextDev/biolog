/* ============================================================================
   Forgot Password — 4-step reset, Calm Mint
   ----------------------------------------------------------------------------
   1. Send code   -> 2. Verify OTP -> 3. New password -> 4. Done

   Rendered as a full-screen auth view rather than a drawer: it is a four-step
   journey, not a dialog, and a bottom sheet would clip the OTP row on short
   screens. Swap it in from the login panel via `ForgotPasswordFlow`.

   Tokens are stateless HMAC tickets from lib/password-reset.ts — nothing is
   written to the database until the final password update.
   ========================================================================== */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { MintButton, MintInput, MintLabel } from "@/components/mint";

const STEPS = ["Send code", "Verify", "New password", "Done"] as const;

const RESEND_SECONDS = 30;
const OTP_LENGTH = 6;

/* ── Password strength ─────────────────────────────────────────────────────── */

const RULES = [
  { test: (v: string) => v.length >= 6, label: "6+ characters" },
  { test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v), label: "upper & lower case" },
  { test: (v: string) => /\d/.test(v), label: "1 number" },
  { test: (v: string) => /[^A-Za-z0-9]/.test(v), label: "1 symbol" },
];

function strengthOf(value: string) {
  if (!value) return { score: 0, label: "Enter a password", missing: RULES.map((r) => r.label) };
  const passed = RULES.filter((r) => r.test(value));
  const missing = RULES.filter((r) => !r.test(value)).map((r) => r.label);
  const labels = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];
  return { score: passed.length, label: labels[passed.length], missing };
}

/* ── Primitives ────────────────────────────────────────────────────────────── */

function AuthShell({
  step,
  onBack,
  icon,
  title,
  subtitle,
  children,
  footer,
}: {
  step: number;
  onBack?: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="mint-ui mint-scope w-full lg:max-w-sm"
      role="region"
      aria-label={`Password reset, step ${step + 1} of ${STEPS.length}`}
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 mb-5">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back"
            className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 transition-colors active:scale-95"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          >
            <ArrowLeft size={18} />
          </button>
        ) : (
          <div className="w-11 h-11 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[10.5px] font-black uppercase tracking-[0.16em] text-[var(--mint-strong)]">
            Step {step + 1} of {STEPS.length}
          </p>
          {/* Segmented progress — filled for completed steps, outlined for current */}
          <div className="flex gap-1.5 mt-1.5" aria-hidden>
            {STEPS.map((label, i) => (
              <div
                key={label}
                className="h-1.5 flex-1 rounded-full transition-colors"
                style={{
                  background:
                    i < step ? "var(--mint)" : i === step ? "var(--mint-soft)" : "var(--border)",
                  outline: i === step ? "1px solid var(--mint)" : undefined,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Title block */}
      <div className="flex items-start gap-3.5 mb-5">
        <div
          className="w-[52px] h-[52px] rounded-[18px] flex items-center justify-center shrink-0"
          style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
        >
          {icon}
        </div>
        <div className="min-w-0 pt-0.5">
          <h1 className="text-[22px] font-black text-[var(--text)] leading-tight tracking-tight">
            {title}
          </h1>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 leading-relaxed">
            {subtitle}
          </p>
        </div>
      </div>

      <motion.div
        key={step}
        initial={{ opacity: 0, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.22 }}
        className="flex flex-col gap-4"
      >
        {children}
      </motion.div>

      {footer && <div className="mt-6">{footer}</div>}
    </div>
  );
}

function Note({
  tone,
  icon,
  children,
}: {
  tone: "info" | "warn";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const map = {
    info: { bg: "var(--info-soft)", fg: "var(--info)" },
    warn: { bg: "var(--hint-bg)", fg: "var(--hint-text)" },
  } as const;
  const t = map[tone];
  return (
    <div
      className="flex items-start gap-2.5 rounded-[var(--r-card)] p-3"
      style={{ background: t.bg, color: t.fg }}
    >
      <span className="shrink-0 mt-px">{icon}</span>
      <p className="text-[11.5px] font-bold leading-relaxed">{children}</p>
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-1.5 text-[12px] font-bold leading-snug"
      style={{ color: "var(--alert-ink)" }}
    >
      <AlertTriangle size={13} className="shrink-0 mt-px" />
      {children}
    </p>
  );
}

/* ── Field with leading icon ───────────────────────────────────────────────── */

const ICON_FIELD =
  "w-full min-h-[52px] pl-11 pr-4 rounded-[var(--r-btn)] border border-[var(--border-strong)] bg-[var(--card)] text-[14px] font-semibold text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none transition-colors focus:border-[var(--mint)]";

function IconField({
  label,
  icon,
  suffix,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon: React.ReactNode;
  suffix?: React.ReactNode;
}) {
  return (
    <label className="block">
      <MintLabel>{label}</MintLabel>
      <div className="relative">
        <span
          className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--text-faint)" }}
        >
          {icon}
        </span>
        <input
          {...rest}
          className={suffix ? `${ICON_FIELD} pr-14` : ICON_FIELD}
          style={{ background: "var(--card)" }}
        />
        {suffix && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2">{suffix}</span>
        )}
      </div>
    </label>
  );
}

/* ── OTP boxes ─────────────────────────────────────────────────────────────── */

function OtpBoxes({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? "");

  const setAt = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, OTP_LENGTH));
  };

  return (
    <div>
      <MintLabel>Verification code</MintLabel>
      <div className="flex gap-1.5 sm:gap-2" role="group" aria-label="6 digit verification code">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            // One digit per box, but a numeric keyboard across the whole row
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            pattern="[0-9]*"
            maxLength={1}
            value={d}
            aria-label={`Digit ${i + 1}`}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, "");
              // Pasting the whole code into any box fills the rest.
              if (raw.length > 1) {
                const merged = (value + raw).replace(/\D/g, "").slice(0, OTP_LENGTH);
                onChange(merged);
                refs.current[Math.min(merged.length, OTP_LENGTH - 1)]?.focus();
                return;
              }
              setAt(i, raw);
              if (raw) refs.current[i + 1]?.focus();
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace") {
                e.preventDefault();
                // Clear this box; if it was already empty, step back and clear there.
                if (digits[i]) {
                  setAt(i, "");
                } else {
                  onChange(digits.slice(0, i).join(""));
                  refs.current[Math.max(0, i - 1)]?.focus();
                }
              }
              if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
              if (e.key === "ArrowRight" && i < OTP_LENGTH - 1) refs.current[i + 1]?.focus();
            }}
            className="flex-1 min-w-0 h-[58px] rounded-[16px] border text-center text-[22px] font-black outline-none transition-colors"
            style={{
              borderColor: d ? "var(--mint)" : "var(--border-strong)",
              background: d ? "var(--mint-soft)" : "var(--card)",
              color: d ? "var(--mint-strong)" : "var(--text-faint)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Strength meter ────────────────────────────────────────────────────────── */

function StrengthMeter({ value }: { value: string }) {
  const { score, label, missing } = useMemo(() => strengthOf(value), [value]);
  const tone = score <= 1 ? "var(--alert)" : score <= 2 ? "var(--clay)" : "var(--mint)";
  return (
    <div>
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors"
            style={{ background: i < score ? tone : "var(--border)" }}
          />
        ))}
      </div>
      <p className="text-[11px] font-bold mt-1.5 leading-snug" style={{ color: tone }}>
        {label}
        {missing.length > 0 && value ? ` — need ${missing.join(", ")}` : ""}
      </p>
    </div>
  );
}

/* ── Flow ──────────────────────────────────────────────────────────────────── */

export default function ForgotPasswordFlow({
  initialEmail = "",
  onExit,
}: {
  /** Prefills step 1 with whatever was typed on the login form. */
  initialEmail?: string;
  /** Called when the user gives up (back arrows, "Back to Login"). */
  onExit: () => void;
}) {
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState(initialEmail);
  const [ticket, setTicket] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [countdown, setCountdown] = useState(0);

  /* Resend cooldown */
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const post = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data: any = {};
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok || data?.success === false) {
      throw new Error(data?.message || "Something went wrong. Please try again.");
    }
    return data;
  };

  /* ── Step 1: request the code ── */
  const sendCode = async () => {
    if (!email.trim() || !email.includes("@")) {
      setError("Enter the email address you registered with.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await post("/api/auth/password-reset-request", { Email: email.trim() });
      if (data.ticket) setTicket(data.ticket);
      setCode("");
      setCountdown(RESEND_SECONDS);
      setStep(1);
      setNotice(data.message || "Check your inbox for the 6-digit code.");
    } catch (err: any) {
      setError(err?.message || "We couldn't send the code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 2: verify ── */
  const verify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter all 6 digits of the code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await post("/api/auth/password-reset-verify", {
        Email: email.trim(),
        code,
        ticket,
      });
      setResetToken(data.resetToken || "");
      setPassword("");
      setConfirm("");
      setStep(2);
    } catch (err: any) {
      setError(err?.message || "We couldn't verify that code.");
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 3: set the new password ── */
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (strengthOf(password).score < 3) {
      setError("Your new password is too easy to guess. Add more of the missing characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/password-reset-complete", { resetToken, newPassword: password });
      setStep(3);
    } catch (err: any) {
      setError(err?.message || "We couldn't update your password.");
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 1 ── */
  if (step === 0) {
    return (
      <AuthShell
        step={0}
        onBack={onExit}
        icon={<Lock size={24} />}
        title="Forgot password?"
        subtitle="Enter the email linked to your account and we'll send a 6-digit verification code."
        footer={
          <button
            type="button"
            onClick={onExit}
            className="w-full min-h-[48px] font-extrabold text-[13px]"
            style={{ color: "var(--mint-strong)" }}
          >
            Remembered it? Back to Login
          </button>
        }
      >
        <IconField
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          placeholder="you@biolog.ph"
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
          icon={<Mail size={16} />}
        />

        <Note tone="info" icon={<Info size={14} />}>
          We&apos;ll send the code to the email registered on your account. Check your{" "}
          <strong>spam / junk folder</strong> if it doesn&apos;t arrive right away.
        </Note>

        <ErrorText>{error}</ErrorText>

        <MintButton
          size="lg"
          full
          loading={busy}
          icon={busy ? undefined : <ArrowRight size={18} />}
          onClick={() => sendCode()}
        >
          {busy ? "Sending…" : "Send Verification Code"}
        </MintButton>
      </AuthShell>
    );
  }

  /* ── Step 2 ── */
  if (step === 1) {
    return (
      <AuthShell
        step={1}
        onBack={() => {
          setError("");
          setStep(0);
        }}
        icon={<ShieldCheck size={24} />}
        title="Verify your email"
        subtitle="We sent a 6-digit code to the address above. Enter it below."
        footer={
          <button
            type="button"
            onClick={onExit}
            className="w-full min-h-[48px] font-extrabold text-[13px]"
            style={{ color: "var(--mint-strong)" }}
          >
            Back to Login
          </button>
        }
      >
        <div
          className="flex items-center gap-2.5 rounded-[var(--r-card)] px-3.5 py-3"
          style={{ background: "var(--mint-soft)" }}
        >
          <Mail size={15} style={{ color: "var(--mint-strong)" }} className="shrink-0" />
          <p className="text-[12.5px] font-extrabold truncate" style={{ color: "var(--mint-strong)" }}>
            {email.trim()}
          </p>
        </div>

        <OtpBoxes value={code} onChange={(v) => { setCode(v); setError(""); }} autoFocus />

        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-bold text-[var(--text-muted)]">
            {countdown > 0 ? (
              <span>
                Didn&apos;t get it?{" "}
                <span style={{ color: "var(--mint-strong)" }}>
                  Resend in 00:{String(countdown).padStart(2, "0")}
                </span>
              </span>
            ) : (
              "Didn't receive the code?"
            )}
          </p>
          <button
            type="button"
            disabled={countdown > 0 || busy}
            onClick={() => sendCode()}
            className="min-h-[44px] px-3 text-[12.5px] font-extrabold disabled:opacity-40"
            style={{ color: "var(--mint-strong)" }}
          >
            {busy ? "Sending…" : "Resend code"}
          </button>
        </div>

        <Note tone="warn" icon={<AlertTriangle size={14} />}>
          <strong>Never share this code with anyone.</strong> Our administrator will never
          ask you for a verification code.
        </Note>

        <ErrorText>{error}</ErrorText>

        <MintButton
          size="lg"
          full
          loading={busy}
          icon={busy ? undefined : <ArrowRight size={18} />}
          onClick={verify}
        >
          {busy ? "Verifying…" : "Verify Code"}
        </MintButton>
      </AuthShell>
    );
  }

  /* ── Step 3 ── */
  if (step === 2) {
    const strong = strengthOf(password).score >= 3;
    const matches = confirm.length > 0 && confirm === password;
    return (
      <form onSubmit={submit} noValidate>
        <AuthShell
          step={2}
          onBack={() => {
            setError("");
            setStep(1);
          }}
          icon={<Lock size={24} />}
          title="Create new password"
          subtitle="Choose a password no one else can easily guess. Minimum 6 characters."
          footer={
            <MintButton
              type="submit"
              size="lg"
              full
              loading={busy}
              icon={busy ? undefined : <ArrowRight size={18} />}
            >
              {busy ? "Updating…" : "Reset Password"}
            </MintButton>
          }
        >
          <div>
            <IconField
              label="New password"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              placeholder="At least 6 characters"
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              icon={<Lock size={16} />}
              suffix={
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="w-11 h-11 rounded-[12px] flex items-center justify-center"
                  style={{ color: "var(--text-faint)" }}
                >
                  {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              }
            />
            <div className="mt-2.5">
              <StrengthMeter value={password} />
            </div>
          </div>

          <IconField
            label="Confirm password"
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            placeholder="Type it again"
            onChange={(e) => {
              setConfirm(e.target.value);
              setError("");
            }}
            icon={<Lock size={16} />}
            suffix={
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? "Hide password" : "Show password"}
                className="w-11 h-11 rounded-[12px] flex items-center justify-center"
                style={{ color: "var(--text-faint)" }}
              >
                {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            }
          />

          {matches && (
            <p
              className="flex items-center gap-1.5 text-[12px] font-extrabold"
              style={{ color: "var(--mint-strong)" }}
            >
              <Check size={14} /> Passwords match
            </p>
          )}

          <ErrorText>{error}</ErrorText>

          {!strong && password.length > 0 && (
            <p className="text-[11.5px] font-semibold text-[var(--text-muted)] -mt-2">
              Aim for at least 3 of the 4 rules — a mix of case, a number and a symbol.
            </p>
          )}
        </AuthShell>
      </form>
    );
  }

  /* ── Step 4 ── */
  return (
    <AuthShell
      step={3}
      icon={
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 18 }}
          className="flex"
        >
          <CheckCircle2 size={26} />
        </motion.span>
      }
      title="Password updated!"
      subtitle="Your password has been updated. You can sign in with your new password."
    >
      <div
        className="flex flex-col items-center py-4"
        role="status"
      >
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.05 }}
          className="w-[92px] h-[92px] rounded-full flex items-center justify-center mb-4"
          style={{
            background: "var(--mint-soft)",
            boxShadow: "0 0 0 10px var(--mint-soft)",
          }}
        >
          <Check size={42} style={{ color: "var(--mint-btn)" }} strokeWidth={3} />
        </motion.div>
        <p
          className="text-[14px] font-black text-center"
          style={{ color: "var(--mint-strong)" }}
        >
          You can sign in now
        </p>
      </div>

      <Note tone="info" icon={<Mail size={14} />}>
        We&apos;ve sent a confirmation email to <strong>{email.trim()}</strong> saying your
        password was changed. If this wasn&apos;t you, contact the Biolog help desk right away.
      </Note>

      <MintButton size="lg" full icon={<ArrowRight size={18} />} onClick={onExit}>
        Back to Login
      </MintButton>
    </AuthShell>
  );
}