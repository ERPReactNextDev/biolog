import React from "react";
import Link from "next/link";
import { SearchX } from "lucide-react";

export default function AdminNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div
        className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-5"
        style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
      >
        <SearchX size={28} />
      </div>
      <p className="text-[20px] font-black text-[var(--text)]">Page not found</p>
      <p className="text-[13px] font-semibold text-[var(--text-muted)] mt-2 max-w-xs leading-relaxed">
        This admin page doesn&apos;t exist yet, or the URL might be wrong.
      </p>
      <Link
        href="/admin"
        className="mt-6 inline-flex items-center gap-2 min-h-[44px] px-6 rounded-[14px] text-[13px] font-extrabold text-white transition-all active:scale-95"
        style={{ background: "var(--mint-btn)" }}
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
