// hooks/useNotifications.ts
// Real-time ticket status notifications via Supabase subscriptions.
// Shows a badge on the ticket nav item and toast when status changes.

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/utils/supabase";

export interface AppNotification {
  id: string;
  ticketId: string;
  message: string;
  status: string;
  readAt: number | null;
  createdAt: number;
}

const LS_KEY = "acculog_notifications";

function loadStored(referenceId: string): AppNotification[] {
  try {
    const raw = localStorage.getItem(`${LS_KEY}_${referenceId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStored(referenceId: string, items: AppNotification[]): void {
  try {
    // Keep only last 50
    const trimmed = items.slice(-50);
    localStorage.setItem(`${LS_KEY}_${referenceId}`, JSON.stringify(trimmed));
  } catch { /* quota */ }
}

export function useNotifications(referenceId: string | null | undefined) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const addNotification = useCallback((n: AppNotification) => {
    setNotifications((prev) => {
      const updated = [...prev, n];
      if (referenceId) saveStored(referenceId, updated);
      return updated;
    });
  }, [referenceId]);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, readAt: n.readAt ?? Date.now() }));
      if (referenceId) saveStored(referenceId, updated);
      return updated;
    });
  }, [referenceId]);

  const clearAll = useCallback(() => {
    setNotifications([]);
    if (referenceId) saveStored(referenceId, []);
  }, [referenceId]);

  // Load stored notifications on mount
  useEffect(() => {
    if (!referenceId) return;
    setNotifications(loadStored(referenceId));
  }, [referenceId]);

  // Subscribe to Supabase real-time ticket changes
  useEffect(() => {
    if (!referenceId) return;

    // Clean up previous subscription
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`tickets:${referenceId}`)
      .on(
        "postgres_changes",
        {
          event:  "UPDATE",
          schema: "public",
          table:  "tickets",
          filter: `referenceid=eq.${referenceId}`,
        },
        (payload) => {
          const ticket = payload.new as any;
          const status = ticket.status ?? "Updated";
          const ticketId = ticket.ticket_id ?? ticket.id;

          const statusMessages: Record<string, string> = {
            "Received":    "Your ticket has been received by the team.",
            "In Progress": "Your ticket is now being worked on.",
            "Resolved":    "Your ticket has been resolved! ✅",
            "Pending":     "Your ticket is pending review.",
          };

          const message = statusMessages[status] ?? `Ticket status updated to: ${status}`;

          const notification: AppNotification = {
            id:        `${ticketId}_${Date.now()}`,
            ticketId,
            message,
            status,
            readAt:    null,
            createdAt: Date.now(),
          };

          addNotification(notification);

          // Show toast
          const toastFn = status === "Resolved" ? toast.success : toast.info;
          toastFn(`🎫 Ticket ${ticketId}: ${message}`, {
            duration: 6000,
            action: {
              label: "View",
              onClick: () => {
                window.location.href = `/ticket?id=${encodeURIComponent(referenceId)}`;
              },
            },
          });

          // Haptic feedback
          if ("vibrate" in navigator) navigator.vibrate([50, 30, 50]);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [referenceId, addNotification]);

  return { notifications, unreadCount, markAllRead, clearAll };
}
