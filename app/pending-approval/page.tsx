"use client";

import { Clock, ShieldCheck, ArrowLeft, Mail } from "lucide-react";
import { useRouter } from "next/navigation";

/*
  /pending-approval
  ──────────────────
  Shown after sign-up (email or Google) while Status === "Revoked".
  The admin must go to User Management → Grant System Access.
*/
export default function PendingApprovalPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">

        {/* Card */}
        <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 flex flex-col items-center text-center gap-6">

          {/* Icon */}
          <div className="relative">
            <div className="w-24 h-24 rounded-[2rem] bg-amber-50 flex items-center justify-center shadow-inner">
              <Clock size={44} className="text-amber-400" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center">
              <ShieldCheck size={16} className="text-brand-primary" />
            </div>
          </div>

          {/* Text */}
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Pending Approval</h1>
            <p className="text-sm text-gray-400 leading-relaxed">
              Your account has been created and is currently under review. An administrator must activate your account before you can log in.
            </p>
          </div>

          {/* Info box */}
          <div className="w-full bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3 text-left">
            <Mail size={15} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed font-medium">
              Once your administrator grants you access, you can return to the login page and sign in normally.
            </p>
          </div>

          {/* Steps */}
          <div className="w-full flex flex-col gap-3">
            {[
              { step: "1", label: "Account submitted", done: true },
              { step: "2", label: "Admin reviews & grants access", done: false },
              { step: "3", label: "You can now log in", done: false },
            ].map(({ step, label, done }) => (
              <div key={step} className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${done ? "bg-green-500 text-white" : "bg-gray-100 text-gray-400"}`}>
                  {done ? "✓" : step}
                </div>
                <span className={`text-sm font-semibold ${done ? "text-green-600" : "text-gray-400"}`}>{label}</span>
              </div>
            ))}
          </div>

          {/* Back to login */}
          <button
            onClick={() => router.push("/Login")}
            className="w-full mt-2 flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white py-3.5 text-sm font-bold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-[0.98]"
          >
            <ArrowLeft size={15} />
            Back to Login
          </button>
        </div>

        <p className="text-center text-[11px] text-gray-400 mt-6">
          © {new Date().getFullYear()} BIOLOG · Time Tracker Activity
        </p>
      </div>
    </div>
  );
}