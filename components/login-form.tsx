"use client";
import React, { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import {
  Eye, EyeOff, ArrowRight, ArrowLeft, Shield, Fingerprint,
  UserPlus, X, ChevronRight, CheckCircle2, Clock, Loader2,
  User, Mail, Lock, Building2, Briefcase, Hash, Info,
} from "lucide-react";
import RegisterSheet from "@/components/register-sheet";
import ForgotPasswordFlow from "@/components/forgot-password-flow";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   GOOGLE ICON (inline SVG â€” no extra dep)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   SIGNUP FORM TYPES
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
interface SignUpForm {
  Firstname: string;
  Lastname: string;
  Email: string;
  Password: string;
  ConfirmPassword: string;
  Department: string;
  Company: string;
  ReferenceID: string;
}

const EMPTY_SIGNUP: SignUpForm = {
  Firstname: "", Lastname: "", Email: "",
  Password: "", ConfirmPassword: "",
  Department: "", Company: "", ReferenceID: "",
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   SIGNUP DIALOG
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function SignUpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<SignUpForm>(EMPTY_SIGNUP);
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  if (!open) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleClose = () => {
    setForm(EMPTY_SIGNUP);
    setDone(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.Password !== form.ConfirmPassword) {
      toast.error("Passwords do not match!");
      return;
    }
    if (form.Password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithTimeout("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Firstname: form.Firstname,
          Lastname: form.Lastname,
          Email: form.Email,
          Password: form.Password,
          Department: form.Department,
          Company: form.Company,
          ReferenceID: form.ReferenceID,
          // Status is always "Revoked" â€” set by the API
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.message || "Sign up failed.");
        return;
      }
      setDone(true);
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setGoogleLoading(true);
    try {
      // Redirect to Google OAuth â€” adjust provider name if using NextAuth
      window.location.href = "/api/auth/signin/google?callbackUrl=/pending-approval";
    } catch {
      toast.error("Google sign-up failed.");
      setGoogleLoading(false);
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 z-10 w-9 h-9 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-all"
        >
          <X size={16} />
        </button>

        {done ? (
          /* â”€â”€ Success State â”€â”€ */
          <div className="flex flex-col items-center text-center p-10 gap-6">
            <div className="w-20 h-20 rounded-[2rem] bg-amber-50 flex items-center justify-center text-amber-500 shadow-inner">
              <Clock size={40} />
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-bold text-gray-900">Account Submitted!</h2>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs">
                Your account has been created and is <span className="font-bold text-amber-600">pending admin approval</span>. You'll be able to login once an administrator grants you access.
              </p>
            </div>
            <div
              className="w-full rounded-[var(--r-card)] p-4 flex items-start gap-3 text-left"
              style={{ background: "var(--hint-bg)", color: "var(--hint-text)" }}
            >
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <p className="text-[12.5px] font-bold leading-relaxed">
                Account created for <span className="font-black">{form.Email}</span>. Contact your
                administrator to activate your account.
              </p>
            </div>
            <button
              onClick={handleClose}
              className="w-full min-h-[52px] rounded-[var(--r-btn)] text-[14.5px] font-extrabold text-white transition-all active:scale-[0.98]"
              style={{ background: "var(--mint-btn)" }}
            >
              Back to Login
            </button>
          </div>
        ) : (
          /* â”€â”€ Sign Up Form â”€â”€ */
          <>
            {/* Header */}
            <div className="px-8 pt-8 pb-0">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Create Account</h2>
                <p className="text-sm text-gray-400">
                  Your account will be reviewed by an admin before you can log in.
                </p>
              </div>

              {/* Google Sign Up */}
              <button
                type="button"
                onClick={handleGoogleSignUp}
                disabled={googleLoading || submitting}
                className="w-full flex items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white py-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mb-5"
              >
                {googleLoading ? (
                  <Loader2 size={16} className="animate-spin" style={{ color: "var(--mint)" }} />
                ) : (
                  <GoogleIcon size={18} />
                )}
                Continue with Google
              </button>

              {/* Divider */}
              <div className="relative flex items-center mb-5">
                <span className="flex-1 border-t border-gray-100" />
                <span className="px-3 text-[11px] font-bold text-gray-300 uppercase tracking-widest">
                  or sign up with email
                </span>
                <span className="flex-1 border-t border-gray-100" />
              </div>
            </div>

            {/* Form body */}
            <form onSubmit={handleSubmit}>
              <div className="px-8 pb-4 flex flex-col gap-4">

                {/* Name row */}
                <div className="grid grid-cols-2 gap-3">
                  <Field icon={<User size={14} />} label="First Name">
                    <input
                      name="Firstname" value={form.Firstname} onChange={handleChange}
                      required placeholder="Juan"
                      className="field-input"
                    />
                  </Field>
                  <Field icon={<User size={14} />} label="Last Name">
                    <input
                      name="Lastname" value={form.Lastname} onChange={handleChange}
                      required placeholder="Dela Cruz"
                      className="field-input"
                    />
                  </Field>
                </div>

                {/* Email */}
                <Field icon={<Mail size={14} />} label="Email Address">
                  <input
                    name="Email" type="email" value={form.Email} onChange={handleChange}
                    required placeholder="juan@company.com"
                    className="field-input"
                  />
                </Field>

                {/* Password row */}
                <div className="grid grid-cols-2 gap-3">
                  <Field icon={<Lock size={14} />} label="Password">
                    <div className="relative">
                      <input
                        name="Password" type={showPass ? "text" : "password"}
                        value={form.Password} onChange={handleChange}
                        required placeholder="Min. 6 chars"
                        className="field-input pr-10"
                      />
                      <button
                        type="button" tabIndex={-1}
                        onClick={() => setShowPass(p => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                      >
                        {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </Field>
                  <Field icon={<Lock size={14} />} label="Confirm Password">
                    <input
                      name="ConfirmPassword" type="password"
                      value={form.ConfirmPassword} onChange={handleChange}
                      required placeholder="Repeat password"
                      className="field-input"
                    />
                  </Field>
                </div>

                {/* Department & Company */}
                <div className="grid grid-cols-2 gap-3">
                  <Field icon={<Building2 size={14} />} label="Department">
                    <input
                      name="Department" value={form.Department} onChange={handleChange}
                      required placeholder="e.g. Sales"
                      className="field-input"
                    />
                  </Field>
                  <Field icon={<Briefcase size={14} />} label="Company (optional)">
                    <input
                      name="Company" value={form.Company} onChange={handleChange}
                      placeholder="e.g. Biolog Inc."
                      className="field-input"
                    />
                  </Field>
                </div>

                {/* Reference ID */}
                <Field icon={<Hash size={14} />} label="Reference / Employee ID">
                  <input
                    name="ReferenceID" value={form.ReferenceID} onChange={handleChange}
                    required placeholder="e.g. EMP-2024-001"
                    className="field-input"
                  />
                </Field>

                {/* Notice */}
                <div className="flex items-start gap-2.5 bg-amber-50 rounded-2xl p-3.5 border border-amber-100 mt-1">
                  <Clock size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700 leading-relaxed font-medium">
                    New accounts are <span className="font-black">pending by default</span>. An administrator must approve your account before you can log in.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div
                className="px-8 py-6 flex gap-3 mt-2"
                style={{ background: "var(--bg)", borderTop: "1px solid var(--border)" }}
              >
                <button
                  type="button" onClick={handleClose}
                  className="flex-1 min-h-[52px] rounded-[var(--r-btn)] text-[14px] font-extrabold transition-all active:scale-[0.98]"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={submitting}
                  className="flex-1 min-h-[52px] rounded-[var(--r-btn)] text-[14px] font-extrabold text-white transition-all active:scale-[0.98] disabled:opacity-45 flex items-center justify-center gap-2"
                  style={{ background: "var(--mint-btn)" }}
                >
                  {submitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      Create Account <ChevronRight size={15} />
                    </>
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   FIELD WRAPPER (small helper)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
        <span className="text-gray-300">{icon}</span>
        {label}
      </label>
      <style jsx>{`
        :global(.field-input) {
          width: 100%;
          min-height: 48px;
          border-radius: var(--r-btn, 18px);
          border: 1px solid var(--border-strong, #cfe3da);
          background: var(--card, #ffffff);
          padding: 0.75rem 1rem;
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text, #0f172a);
          outline: none;
          transition: border-color 0.15s;
        }
        :global(.field-input::placeholder) { color: var(--text-faint, #94a3b8); }
        :global(.field-input:focus) {
          border-color: var(--mint, #0d9669);
          box-shadow: 0 0 0 3px rgba(13, 150, 105, 0.1);
        }
      `}</style>
      {children}
    </div>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   LOGIN FORM  (original + signup button)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [Email, setEmail] = useState("");
  const [Password, setPassword] = useState("");

  const [otp, setOtp] = useState("");
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  // Sign-up is a bottom drawer; "Forgot password?" swaps the whole panel for
  // the 4-step reset flow (both specs call for a drawer / full-screen view).
  const [registerOpen, setRegisterOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [googleLoginLoading, setGoogleLoginLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const router = useRouter();

  /* "Remember me" keeps the email address only — never the password. */
  useEffect(() => {
    const saved = localStorage.getItem("acculog_login_email");
    if (saved) {
      setEmail(saved);
      setRememberMe(true);
    }
  }, []);

  const toggleRemember = (next: boolean) => {
    setRememberMe(next);
    if (next) {
      if (Email.trim()) localStorage.setItem("acculog_login_email", Email.trim());
    } else {
      localStorage.removeItem("acculog_login_email");
    }
  };

  useEffect(() => {
    const syncOnlineState = () => {
      setIsOnline(navigator.onLine);
    };

    syncOnlineState();
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);

    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  React.useEffect(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      // Offline branch: load branding from localStorage cache
      const raw = localStorage.getItem("acculog_settings_cache");
      if (raw) {
        try {
          const cached = JSON.parse(raw);
          setSettings(cached);
          if (cached.themeColor) {
            document.documentElement.setAttribute("data-theme", cached.themeColor);
          }
        } catch {
          // Corrupted cache â€” silently ignore; default logo/styles apply via built-in fallbacks
        }
      }
      // If no cache found, return without error â€” built-in fallbacks handle rendering
      return;
    }

    fetch("/api/admin/settings")
      .then(r => r.json())
      .then(data => {
        setSettings(data);
        localStorage.setItem("acculog_settings_cache", JSON.stringify(data));
        if (data.themeColor) {
          document.documentElement.setAttribute("data-theme", data.themeColor);
        }
      })
      .catch(() => {});
  }, []);

  function getDeviceId() {
    let deviceId = localStorage.getItem("deviceId");
    if (!deviceId) {
      deviceId = uuidv4();
      localStorage.setItem("deviceId", deviceId);
    }
    return deviceId;
  }

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      let deviceId = getDeviceId();
      e.preventDefault();
      if (!Email || !Password) {
        toast.error("Email and Password are required!");
        return;
      }
      setLoading(true);

      // Fast-path: if browser knows we're offline, skip the network round-trip
      // and verify directly against the local cache.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const { verifyOfflineCredential } = await import("@/lib/offline-auth");
        const offlineResult = await verifyOfflineCredential({
          email:      Email,
          secret:     Password,
          isPinLogin: false,
        });
        if (offlineResult) {
          // â”€â”€ Set session start time for session timeout hook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          localStorage.setItem("acculog_session_start", Date.now().toString());
          
          // â”€â”€ Store userId in localStorage for future visits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          localStorage.setItem("userId", offlineResult.userId);
          
          // Persist offline session so protected pages stay accessible
          try {
            const { setOfflineSession } = await import("@/lib/offline-auth");
            await setOfflineSession(offlineResult.userId);
          } catch { /* silent */ }
          toast.success("Offline login â€” using cached credentials.");
          setTimeout(() => {
            router.push(`/activity-planner?id=${encodeURIComponent(offlineResult.userId)}`);
          }, 600);
        } else {
          toast.error("You are offline and these credentials are not cached.");
        }
        setLoading(false);
        return;
      }

      try {
        const res = await fetchWithTimeout("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include", cache: "no-store", // Important: receive cookies in response!
          body: JSON.stringify({
            Email,
            Password,
            deviceId, otp,
          }),
        });
        const result = await res.json();

        if (res.ok && result.twoFactorRequired) {
          setTwoFactorRequired(true);
          toast.info("Verification code sent to your email.");
          return;
        }

        if (res.ok && result.userId) {
          console.log("[LoginForm] Login successful! userId:", result.userId);
          
          // â”€â”€ Store userId in localStorage for future visits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          localStorage.setItem("userId", result.userId);
          console.log("[LoginForm] Set userId in localStorage:", result.userId);
          
          // â”€â”€ Set session start time for session timeout hook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          localStorage.setItem("acculog_session_start", Date.now().toString());
          console.log("[LoginForm] Set acculog_session_start in localStorage");
          
          // â”€â”€ Cache credentials for offline login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          let cached = false;
          try {
            const { cacheCredential, setOfflineSession } = await import("@/lib/offline-auth");
            await cacheCredential({
              email:      Email,
              secret:     Password,
              isPinLogin: false,
              userId:     result.userId,
            });
            await setOfflineSession(result.userId);
            console.log("[LoginForm] Offline credentials cached successfully");
            cached = true;
          } catch (cacheErr) {
            // Log so we can debug â€” but don't block login
            console.warn("[offline-auth] cacheCredential failed:", cacheErr);
          }

          toast.success(
            cached
              ? "Login successful! Credentials saved for offline use."
              : "Login successful! (Offline cache unavailable on this device)"
          );
          console.log("[LoginForm] About to redirect to activity-planner...");
          setTimeout(() => {
            router.push(`/activity-planner?id=${encodeURIComponent(result.userId)}`);
          }, 800);
        } else {
          toast.error(result.message || "Login failed!");
        }
      } catch {
        // Network failed mid-request â€” try the offline cache as a fallback.
        try {
          const { verifyOfflineCredential } = await import("@/lib/offline-auth");
          const offlineResult = await verifyOfflineCredential({
            email:      Email,
            secret:     Password,
            isPinLogin: false,
          });
          if (offlineResult) {
            // â”€â”€ Set session start time for session timeout hook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            localStorage.setItem("acculog_session_start", Date.now().toString());
            
            // â”€â”€ Store userId in localStorage for future visits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            localStorage.setItem("userId", offlineResult.userId);
            
            // Persist offline session so protected pages stay accessible
            try {
              const { setOfflineSession } = await import("@/lib/offline-auth");
              await setOfflineSession(offlineResult.userId);
            } catch { /* silent */ }
            toast.success("Offline login â€” using cached credentials.");
            setTimeout(() => {
              router.push(`/activity-planner?id=${encodeURIComponent(offlineResult.userId)}`);
            }, 600);
            return;
          }
        } catch { /* silent */ }
        toast.error("Connection error. Please check your internet and try again.");
      } finally {
        setLoading(false);
      }
    },
    [Email, Password, otp, router]
  );

  const handleBiometricLogin = useCallback(async () => {
    // Biometric login requires internet - check first
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("Biometric login requires internet. Please use Email/Password to login offline.");
      return;
    }
    
    setBiometricLoading(true);
    let deviceId = getDeviceId();
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const credential = await navigator.credentials.get({
        publicKey: { 
          challenge, 
          rpId: window.location.hostname, 
          userVerification: "required",
        },
      }) as any;
      if (!credential) throw new Error("Biometric authentication failed.");
      console.log("Biometric credential obtained:", credential);
      const response = await fetchWithTimeout("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include", cache: "no-store", // Important: receive cookies in response!
          body: JSON.stringify({ credentialId: credential.id, deviceId }),
        });
      const result = await response.json();
      console.log("Login API response:", result);
      if (response.ok && result.userId) {
        // â”€â”€ Set session start time for session timeout hook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        localStorage.setItem("acculog_session_start", Date.now().toString());
        
        // â”€â”€ Store userId in localStorage for future visits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        localStorage.setItem("userId", result.userId);
        
        // Store offline session for protected page access
        const { setOfflineSession } = await import("@/lib/offline-auth");
        await setOfflineSession(result.userId).catch(() => {});
        toast.success("Biometric login successful!");
        setTimeout(() => {
          router.push(`/activity-planner?id=${encodeURIComponent(result.userId)}`);
        }, 800);
      } else {
        toast.error(result.message || "Biometric login failed!");
      }
    } catch (err: any) {
      console.error("Biometric login error:", err);
      if (err.name !== "NotAllowedError") toast.error(err.message || "An error occurred during biometric login.");
    } finally {
      setBiometricLoading(false);
    }
  }, [router]);

  return (
    <>
      {/* Sign-up drawer — the spec asks for a bottom sheet, not a page jump. */}
      <RegisterSheet open={registerOpen} onOpenChange={setRegisterOpen} />

      {/* `mint-ui` is required here: app/layout.tsx puts `font-mono` on <body>,
          so without it the whole screen renders in monospace. */}
      <div className={cn("mint-ui mint-scope min-h-svh w-full flex", className)} {...props}>

        {/* Left Panel - Branding (soft mint, not a dark red wall)

            THE THREE FIXES HERE
            1. One brand mark per viewport, not two. This panel owns the logo on
               desktop; the right column's own logo is `lg:hidden` below. Two
               BIOLOG marks side by side across the fold reads as a rendering
               bug, and it was one.
            2. Vertical rhythm. `justify-between` around a `flex-1 justify-center`
               middle stranded the headline in the leftover space, so the void
               above it grew with the viewport height. The three rows are now
               explicit — logo / centred content / footer — and the right column
               uses the same rhythm, so the two sides read as one composition
               rather than two independently-parked columns.
            3. The headline is a clamp, not a fixed 40px. In a half-width column
               minus the padding, 40px overran the measure and the third line
               fell onto a fourth. */}
        <div
          className="hidden lg:flex lg:w-1/2 flex-col relative overflow-hidden px-6 sm:px-10 xl:px-14 2xl:px-20"
          style={{ background: "linear-gradient(160deg, var(--mint-gradient) 0%, var(--bg) 55%, var(--mint-soft) 100%)" }}
        >
          <div
            className="absolute -top-20 -right-20 w-80 h-80 rounded-full pointer-events-none"
            style={{ background: "rgba(13,150,105,.05)" }}
          />
          <div
            className="absolute top-1/3 -left-16 w-64 h-64 rounded-full pointer-events-none"
            style={{ background: "rgba(13,150,105,.04)" }}
          />
          <div
            className="absolute -bottom-24 right-16 w-96 h-96 rounded-full pointer-events-none"
            style={{ background: "rgba(13,150,105,.035)" }}
          />

          {/* Every row carries the same max-w so the logo, the pitch and the footer
              stay on one left-hand edge. The panel itself is now full-bleed,
              so without this the measure would be set by the monitor width
              and a 40px headline would stretch across a very wide screen. */}
          {/* Row 1 — brand, top anchored */}
          <div className="relative z-10 w-full max-w-[600px] pt-9 xl:pt-11 shrink-0">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-[15px] flex items-center justify-center overflow-hidden shrink-0"
                style={{ background: "var(--mint-btn)", boxShadow: "var(--sh-btn)" }}
              >
                {settings?.logoUrl ? (
                  <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
                ) : (
                  <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden>
                    <rect x="2" y="8" width="14" height="2" rx="1" fill="white" />
                    <rect x="2" y="4" width="9" height="2" rx="1" fill="white" />
                    <rect x="2" y="12" width="11" height="2" rx="1" fill="white" />
                  </svg>
                )}
              </div>
              <span className="text-[16px] font-black tracking-[0.12em] text-[var(--mint-strong)]">
                BIOLOG
              </span>
            </div>
          </div>

          {/* Row 2 — the pitch, centred in what is left */}
          <div className="relative z-10 w-full max-w-[600px] flex-1 flex flex-col justify-center py-8 min-h-0">
            <div className="mb-7">
              <div
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 mb-5"
                style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
              >
                <Shield size={13} />
                <span className="text-[12px] font-extrabold tracking-wide">
                  Secure Time Tracking
                </span>
              </div>
              {/* clamp(), not a fixed size — see note 3 above. */}
              <h2
                className="font-black leading-[1.12] mb-4 text-[var(--text)]"
                style={{ fontSize: "clamp(28px, 2.6vw, 40px)", letterSpacing: "-0.02em" }}
              >
                Track time.
                <br />
                Stay on field.
                <br />
                <span style={{ color: "var(--mint)" }}>Stay accountable.</span>
              </h2>
              <p className="text-[14.5px] font-semibold leading-relaxed max-w-[38ch] text-[var(--text-muted)]">
                A unified platform for field attendance, site visits, and timesheet management
                &mdash; built for your team&apos;s daily operations.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              {[
                { label: "Real-time GPS tracking", sub: "know where your team is" },
                { label: "Client visit logs", sub: "track every site interaction" },
                { label: "Automated timesheets", sub: "hours calculated automatically" },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-3">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: "var(--mint)" }}
                  />
                  <div>
                    <span className="text-[13.5px] font-extrabold text-[var(--text)]">
                      {f.label}
                    </span>{" "}
                    <span className="text-[13px] font-semibold text-[var(--text-muted)]">
                      &mdash; {f.sub}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Row 3 — footer, bottom anchored */}
          <div className="relative z-10 w-full max-w-[600px] pb-9 xl:pb-11 shrink-0">
            <p className="text-[11px] font-bold tracking-wider text-[var(--text-faint)]">
              &copy; {new Date().getFullYear()} BIOLOG &middot; Time Tracker Activity
            </p>
          </div>
        </div>

        {/* Right Panel - Login Form

            Same three-row rhythm as the branding panel, so the two columns
            compose as one screen instead of two independently-parked ones.

            THE LOGO IS `lg:hidden` — that is the fix for the duplicate brand
            mark. It was rendering at the top of this column on EVERY viewport,
            including desktop where the left panel already shows one. Below lg
            the left panel is hidden, so the logo has to live here or the mobile
            screen has no brand at all. */}
        <div
          className="flex-1 lg:w-1/2 flex flex-col relative overflow-hidden"
          style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--bg) 42%, var(--card) 100%)" }}
        >
          {/* Decorative mint wash, per the design */}
          <div
            className="absolute -top-16 -right-16 w-56 h-56 rounded-full pointer-events-none"
            style={{ background: "rgba(13,150,105,.06)" }}
          />
          <div
            className="absolute top-24 -left-20 w-48 h-48 rounded-full pointer-events-none"
            style={{ background: "rgba(13,150,105,.045)" }}
          />

          {/* Row 1 — brand, MOBILE ONLY. On desktop the left panel owns it. */}
          <div className="lg:hidden w-full px-6 pt-6 pb-1 flex items-center justify-center gap-2.5 relative shrink-0">
            <div
              className="w-11 h-11 rounded-[15px] flex items-center justify-center overflow-hidden shrink-0"
              style={{ background: "var(--mint-btn)", boxShadow: "var(--sh-btn)" }}
            >
              {settings?.logoUrl ? (
                <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <rect x="2" y="8" width="14" height="2" rx="1" fill="white" />
                  <rect x="2" y="4" width="9" height="2" rx="1" fill="white" />
                  <rect x="2" y="12" width="11" height="2" rx="1" fill="white" />
                </svg>
              )}
            </div>
            <span className="text-[16px] font-black tracking-[0.12em] text-[var(--mint-strong)]">
              BIOLOG
            </span>
          </div>

          {/* Row 2 — the form, centred.

              min-h-0 matters: a flex child defaults to min-height:auto, so a
              tall form (the 4-step password reset lives here too) refuses to
              shrink and shoves the footer off-screen instead of scrolling
              inside this row. */}
          <div className="flex-1 flex flex-col justify-center relative px-6 py-4 sm:py-6 min-h-0">
            {/* The form keeps its own measure and stays centred. Now that the column is
              as wide as the monitor, a bare max-w-sm would leave it adrift in
              the middle of a very wide area — hence a slightly wider cap from
              xl up, which keeps it reading as a deliberate panel rather than a
              stray strip. */}
            <div className="w-full max-w-sm sm:max-w-md mx-auto">
            {resetOpen ? (
              /* The 4-step reset journey replaces the login panel entirely. */
              <ForgotPasswordFlow
                initialEmail={Email}
                onExit={() => setResetOpen(false)}
              />
            ) : (
              <>
            {/* Heading */}
            <div className="mb-6">
              <h1 className="text-[26px] font-black text-[var(--text)] mb-1.5 leading-tight tracking-tight">
                Welcome back
              </h1>
              <p className="text-[13.5px] font-semibold text-[var(--text-muted)] leading-relaxed">
                Sign in to clock in, log site visits, and see your attendance.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:gap-4">
              {/* Email */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="email"
                  className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)]"
                >
                  Email Address
                </label>
                <div className="relative">
                  <span
                    className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: "var(--text-faint)" }}
                  >
                    <Mail size={16} />
                  </span>
                  <input
                    id="email" type="email" value={Email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@biolog.ph"
                    required autoComplete="email" disabled={loading}
                    className="w-full min-h-[52px] rounded-[var(--r-btn)] border border-[var(--border-strong)] bg-[var(--card)] pl-11 pr-4 text-[14px] font-semibold text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none transition-colors focus:border-[var(--mint)]"
                  />
                </div>
              </div>

              {/* OTP (2FA) */}
              {twoFactorRequired && (
                <div className="flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                  <label
                    htmlFor="otp"
                    className="text-[11px] font-extrabold uppercase tracking-[0.14em] flex items-center gap-2"
                    style={{ color: "var(--mint-strong)" }}
                  >
                    <Shield size={12} /> Verification Code
                  </label>
                  <input
                    id="otp" type="text" maxLength={6}
                    value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000" required disabled={loading}
                    className="mint-num w-full min-h-[56px] rounded-[var(--r-btn)] border-2 bg-[var(--card)] px-4 text-center text-[20px] font-black tracking-[8px] text-[var(--text)] placeholder:text-[var(--text-faint)] placeholder:tracking-normal outline-none transition-colors"
                    style={{ borderColor: "rgba(13,150,105,.25)" }}
                  />
                  <p className="text-[11.5px] font-semibold text-[var(--text-muted)] text-center">
                    Enter the 6-digit code from your authenticator app
                  </p>
                </div>
              )}

              {/* Password */}
              {!twoFactorRequired && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor="password"
                      className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)]"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setResetOpen(true)}
                      className="min-h-[44px] -mb-1 text-[12px] font-extrabold"
                      style={{ color: "var(--mint-strong)" }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <span
                      className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: "var(--text-faint)" }}
                    >
                      <Lock size={16} />
                    </span>
                    <input
                      id="password" type={showPassword ? "text" : "password"}
                      value={Password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password" required autoComplete="current-password" disabled={loading}
                      className="w-full min-h-[52px] rounded-[var(--r-btn)] border border-[var(--border-strong)] bg-[var(--card)] pl-11 pr-14 text-[14px] font-semibold text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none transition-colors focus:border-[var(--mint)]"
                    />
                    <button
                      type="button" tabIndex={-1}
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 rounded-[12px] flex items-center justify-center transition-colors"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>
              )}

              {/* Remember me

                      min-h-[44px] on the LABEL is the touch target, not the
                      22px box: the real <input> is `sr-only` (a peer for the
                      styling), so without this the whole control measured 22px
                      tall and was a poor tap target on a phone. -mt-1 pulls the
                      extra height back so the layout does not grow. */}
              {!twoFactorRequired && (
                <label className="flex items-center gap-2.5 min-h-[44px] -mt-1 cursor-pointer select-none">
                  <span className="relative flex items-center justify-center shrink-0">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => toggleRemember(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className="w-[22px] h-[22px] rounded-[7px] border-2 flex items-center justify-center transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
                      style={{
                        borderColor: rememberMe ? "var(--mint-btn)" : "var(--border-strong)",
                        background: rememberMe ? "var(--mint-btn)" : "var(--card)",
                      }}
                    >
                      {rememberMe && (
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
                  <span className="text-[12.5px] font-bold text-[var(--text-muted)]">
                    Remember me on this device
                  </span>
                </label>
              )}

              {/* Submit */}
              <button
                type="submit" disabled={loading || biometricLoading}
                className="mint-tap mt-1 w-full min-h-[56px] rounded-[20px] text-[16px] font-extrabold flex items-center justify-center gap-2.5 transition-all disabled:opacity-45"
                style={{
                  background: loading || biometricLoading ? "var(--border)" : "var(--mint-btn)",
                  color: loading || biometricLoading ? "var(--text-faint)" : "white",
                  boxShadow: loading || biometricLoading ? "none" : "var(--sh-btn)",
                }}
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {twoFactorRequired ? "Verifyingâ€¦" : "Signing inâ€¦"}
                  </>
                ) : (
                  <>
                    {twoFactorRequired ? "Complete Sign In" : "Sign In"}
                    <ArrowRight size={17} />
                  </>
                )}
              </button>

              {/* Back from 2FA */}
              {twoFactorRequired && (
                <button
                  type="button"
                  onClick={() => { setTwoFactorRequired(false); setOtp(""); }}
                  className="min-h-[44px] text-[12.5px] font-extrabold text-[var(--mint-strong)]"
                >
                  &larr; Back to Password
                </button>
              )}

              {/* Biometric + Sign Up */}
              {!twoFactorRequired && (
                <>
                  {/* my-2 rather than my-3: the divider only has to separate the submit
                      button from the social buttons, and on a short phone every
                      8px here is 8px of scroll. */}
                  <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" style={{ borderColor: "var(--border-strong)" }} />
                    </div>
                    <div className="relative flex justify-center">
                      <span
                        className="px-3 text-[10.5px] uppercase tracking-[0.14em] font-extrabold"
                        style={{ background: "var(--bg)", color: "var(--text-faint)" }}
                      >
                        Or
                      </span>
                    </div>
                  </div>

                  {/* Google */}
                  <button
                    type="button"
                    onClick={() => {
                      setGoogleLoginLoading(true);
                      window.location.href = "/api/auth/google";
                    }}
                    disabled={loading || biometricLoading || googleLoginLoading || !isOnline}
                    className="mint-tap w-full min-h-[52px] rounded-[var(--r-btn)] text-[14.5px] font-extrabold flex items-center justify-center gap-2.5 transition-all border disabled:opacity-45"
                    style={{
                      background: "var(--card)",
                      borderColor: "var(--border)",
                      color: "var(--text)",
                    }}
                  >
                    {googleLoginLoading ? (
                      <>
                        <Loader2 size={17} className="animate-spin" style={{ color: "var(--mint)" }} />
                        Redirecting&hellip;
                      </>
                    ) : (
                      <>
                        <GoogleIcon size={18} /> Continue with Google
                      </>
                    )}
                  </button>

                  {/* Biometric */}
                  <button
                    type="button" onClick={handleBiometricLogin}
                    disabled={loading || biometricLoading || googleLoginLoading || !isOnline}
                    className="mint-tap w-full min-h-[52px] rounded-[var(--r-btn)] text-[14.5px] font-extrabold flex items-center justify-center gap-2.5 transition-all disabled:opacity-45"
                    style={{
                      background: "var(--mint-soft)",
                      color: "var(--mint-strong)",
                    }}
                  >
                    {biometricLoading ? (
                      <>
                        <Loader2 size={17} className="animate-spin" style={{ color: "var(--mint-strong)" }} />
                        Verifying&hellip;
                      </>
                    ) : (
                      <>
                        <Fingerprint size={18} style={{ color: "var(--mint-strong)" }} />
                        Login with Fingerprint
                      </>
                    )}
                  </button>

                  {/* One info box, not two. The design shows a single blue note
                      under the fingerprint button; it used to be duplicated as a
                      separate offline banner further up the form. */}
                  <div
                    className="flex items-start gap-2.5 rounded-[var(--r-card)] px-3.5 py-2.5"
                    style={{ background: "var(--info-soft)", color: "var(--info)" }}
                    data-testid={isOnline ? "fingerprint-note" : "offline-login-note"}
                  >
                    <Info size={14} className="shrink-0 mt-px" />
                    <p className="text-[11.5px] font-bold leading-relaxed">
                      {isOnline ? (
                        <>
                          Fingerprint login needs internet. Use email and password when
                          you&apos;re offline.
                        </>
                      ) : (
                        <>
                          You&apos;re offline. Email and password still work on this device.
                          Google and fingerprint sign-in need a connection.
                        </>
                      )}
                    </p>
                  </div>

                  {/* Sign up */}
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span className="text-[13px] font-semibold text-[var(--text-muted)]">
                      Don&apos;t have an account?
                    </span>
                    <button
                      type="button"
                      onClick={() => setRegisterOpen(true)}
                      disabled={!isOnline}
                      className="min-h-[44px] text-[13px] font-extrabold flex items-center gap-1 transition-opacity disabled:opacity-50"
                      style={{ color: "var(--mint-strong)" }}
                    >
                      <UserPlus size={14} /> Create account
                    </button>
                  </div>
                </>
              )}
            </form>
              </>
            )}
            {/* closes the max-w-sm content wrapper */}
            </div>
          </div>

          {/* Row 3 — footer, MOBILE ONLY. Matches the branding panel's
              bottom-anchored row so both columns share one rhythm, and the
              padding respects the iPhone home indicator. */}
          <p className="lg:hidden px-6 pb-6 pt-1 text-[11px] font-semibold text-[var(--text-faint)] text-center relative shrink-0">
            &copy; {new Date().getFullYear()} BIOLOG &middot; Time Tracker Activity
          </p>
        </div>
      </div>
    </>
  );
}
