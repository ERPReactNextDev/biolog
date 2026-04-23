// lib/push-notifications.ts
// Firebase Cloud Messaging — client-side push notification setup.

import { getMessaging, getToken, onMessage, type Messaging } from "firebase/messaging";
import { initializeApp, getApps } from "firebase/app";

const firebaseConfig = {
  apiKey:            "AIzaSyCNonSOohWCFdgL052XUFFZTH1orbP2dH4",
  authDomain:        "taskflow-4605f.firebaseapp.com",
  projectId:         "taskflow-4605f",
  storageBucket:     "taskflow-4605f.firebasestorage.app",
  messagingSenderId: "558742255762",
  appId:             "1:558742255762:web:5725b5c26f1c6fae9e8e4b",
  measurementId:     "G-9J1LXQ8YZC",
};

// VAPID key — generate from Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
// Replace this with your actual VAPID key from Firebase Console
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "";

let messaging: Messaging | null = null;

function getMessagingInstance(): Messaging | null {
  if (typeof window === "undefined") return null;
  try {
    const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
    return getMessaging(app);
  } catch {
    return null;
  }
}

/**
 * Request notification permission and get FCM token.
 * Saves the token to the server so we can send targeted pushes.
 */
export async function initPushNotifications(userId: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!("Notification" in window)) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    messaging = getMessagingInstance();
    if (!messaging) return null;

    if (!VAPID_KEY) {
      console.warn("[push] NEXT_PUBLIC_FIREBASE_VAPID_KEY not set — push notifications disabled");
      return null;
    }

    const token = await getToken(messaging, {
      vapidKey:          VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.ready,
    });

    if (token) {
      // Save token to server
      await fetch("/api/push/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ userId, token }),
      }).catch(() => {});
    }

    return token;
  } catch (err) {
    console.warn("[push] initPushNotifications failed:", err);
    return null;
  }
}

/**
 * Listen for foreground messages (app is open).
 * Returns an unsubscribe function.
 */
export function onForegroundMessage(
  callback: (payload: { title: string; body: string; data?: Record<string, string> }) => void
): () => void {
  if (!messaging) {
    messaging = getMessagingInstance();
  }
  if (!messaging) return () => {};

  const unsubscribe = onMessage(messaging, (payload) => {
    const title = payload.notification?.title ?? "Biolog";
    const body  = payload.notification?.body  ?? "";
    const data  = payload.data as Record<string, string> | undefined;
    callback({ title, body, data });
  });

  return unsubscribe;
}
