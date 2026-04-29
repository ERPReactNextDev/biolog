"use client";

import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Download, X } from "lucide-react";
import { useState } from "react";

export function PWAInstallPrompt() {
  const { isInstallable, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);

  if (!isInstallable || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-4 flex items-center gap-3 animate-in slide-in-from-bottom-2">
      <div className="flex-shrink-0 w-10 h-10 bg-[#CC1318] rounded-lg flex items-center justify-center">
        <Download className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">Install Biolog</p>
        <p className="text-xs text-gray-500">Add to home screen for quick access</p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 p-1 hover:bg-gray-100 rounded"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4 text-gray-400" />
      </button>
      <button
        onClick={promptInstall}
        className="flex-shrink-0 px-3 py-1.5 bg-[#CC1318] text-white text-xs font-bold rounded-lg hover:bg-[#a01015] transition-colors"
      >
        Install
      </button>
    </div>
  );
}
