"use client";

/* ============================================================================
   /Register — direct-link entry to the sign-up flow.

   Sign-up is normally a bottom drawer opened from the login screen. This route
   renders the exact same <RegisterForm> in a card so a shared /Register link
   still works without duplicating the fields.
   ========================================================================== */

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { RegisterForm } from "@/components/register-sheet";

export default function RegisterPage() {
  const router = useRouter();

  return (
    <div
      className="mint-ui mint-scope flex min-h-svh items-center justify-center px-4 py-8"
      style={{ background: "var(--bg)" }}
    >
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div
            className="w-11 h-11 rounded-[15px] flex items-center justify-center"
            style={{ background: "var(--mint-btn)", boxShadow: "var(--sh-btn)" }}
          >
            <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden>
              <rect x="2" y="8" width="14" height="2" rx="1" fill="white" />
              <rect x="2" y="4" width="9" height="2" rx="1" fill="white" />
              <rect x="2" y="12" width="11" height="2" rx="1" fill="white" />
            </svg>
          </div>
          <span className="text-[16px] font-black tracking-[0.12em] text-[var(--mint-strong)]">
            BIOLOG
          </span>
        </div>

        <div
          className="rounded-[var(--r-card-lg)] border p-5"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            boxShadow: "var(--sh-card-lg)",
          }}
        >
          <div className="flex items-start gap-3 mb-5">
            <div
              className="w-[46px] h-[46px] rounded-[16px] flex items-center justify-center shrink-0"
              style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
            >
              <ShieldCheck size={22} />
            </div>
            <div className="min-w-0 pt-0.5">
              <h1 className="text-[20px] font-black text-[var(--text)] leading-tight tracking-tight">
                Create Account
              </h1>
              <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 leading-relaxed">
                Your account will be reviewed by an admin before you can log in.
              </p>
            </div>
          </div>

          <RegisterForm id="register-page-form" onDone={() => router.push("/Login")} />
        </div>

        <p className="mt-5 text-[12.5px] font-semibold text-[var(--text-muted)] text-center">
          Already have an account?{" "}
          <button
            onClick={() => router.push("/Login")}
            className="min-h-[44px] font-extrabold"
            style={{ color: "var(--mint-strong)" }}
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}