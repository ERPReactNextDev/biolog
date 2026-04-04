// components/ProtectedPageWrapper.tsx

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ProtectedPageWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      const deviceId = localStorage.getItem("deviceId") || "";

      const res = await fetch("/api/check-session", {
        headers: { "x-device-id": deviceId },
      });

      if (res.status !== 200) {
        router.push("/Login");
        return;
      }

      setLoading(false);
    };

    checkSession();
  }, [router]);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then(data => {
        if (data.themeColor) {
          document.documentElement.setAttribute("data-theme", data.themeColor);
        }
      });
  }, []);

  if (loading) return <div>Loading...</div>;

  return <>{children}</>;
}
