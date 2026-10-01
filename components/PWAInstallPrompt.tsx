"use client";

import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Download, X } from "lucide-react";
import { useState } from "react";

export function PWAInstallPrompt() {
  const { isInstallable, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);

  if (!isInstallable || dismissed) return null;

  return (
    <div
      className="mint-ui fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 p-4 flex items-center gap-3 animate-in slide-in-from-bottom-2"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-card-lg)",
        boxShadow: "var(--sh-card-lg)",
      }}
      role="dialog"
      aria-label="Install Biolog"
    >
      <div
        className="flex-shrink-0 w-11 h-11 rounded-[14px] flex items-center justify-center"
        style={{ background: "var(--mint-btn)", color: "white" }}
      >
        <Download className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-extrabold text-[var(--text)]">Install Biolog</p>
        <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
          Add to your home screen — opens faster and works on mobile data
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 w-11 h-11 rounded-[12px] flex items-center justify-center"
        style={{ color: "var(--text-faint)" }}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
      <button
        onClick={promptInstall}
        className="flex-shrink-0 px-4 min-h-[44px] rounded-[14px] text-[12.5px] font-extrabold text-white"
        style={{ background: "var(--mint-btn)" }}
      >
        Install
      </button>
    </div>
  );
}
