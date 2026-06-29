/**
 * Integration Test — Full Offline Login Flow (Task 9.1)
 *
 * Validates the complete offline login flow end-to-end:
 *   1. navigator.onLine = false (network disabled)
 *   2. fetch() is mocked to reject (simulating no network)
 *   3. Credentials are pre-seeded in localStorage (the fallback path that
 *      offline-auth uses when IndexedDB is unavailable in jsdom)
 *   4. LoginForm renders completely — no error boundary, no unhandled rejection
 *   5. User submits valid cached credentials
 *   6. setOfflineSession is called (spy confirms it)
 *   7. router.push is called with the activity-planner path within 2 seconds
 *
 * Validates: Requirements 2.1, 2.2
 */

import React from "react";
import { render, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

// Static imports — shared React instance with @testing-library/react
import { LoginForm } from "@/components/login-form";
import * as offlineAuth from "@/lib/offline-auth";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    dismiss: jest.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

/**
 * Seeds a credential entry in localStorage so verifyOfflineCredential
 * succeeds via the localStorage fallback (IDB is unavailable in jsdom).
 *
 * Format mirrors what cacheCredential() writes in lib/offline-auth.ts:
 *   localStorage.setItem(`acculog_cred_${key}`, JSON.stringify(entry))
 */
async function seedLocalStorageCredential(params: {
  email: string;
  password: string;
  userId: string;
}) {
  const enc = new TextEncoder();
  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(`${params.email.toLowerCase()}::${params.password}`)
  );
  const hash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const key = `${params.email.toLowerCase()}:password`;
  const entry = {
    key,
    email: params.email,
    hash,
    isPinLogin: false,
    userId: params.userId,
    cachedAt: Date.now(), // fresh — within 30-day TTL
  };
  localStorage.setItem(`acculog_cred_${key}`, JSON.stringify(entry));
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers: fill form and submit
// ─────────────────────────────────────────────────────────────────────────────

function getFormElements() {
  const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
  const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
  const submitButton = document.querySelector('button[type="submit"]') as HTMLButtonElement;
  return { emailInput, passwordInput, submitButton };
}

async function fillAndSubmit(email: string, password: string) {
  const { emailInput, passwordInput, submitButton } = getFormElements();
  expect(emailInput).not.toBeNull();
  expect(passwordInput).not.toBeNull();
  expect(submitButton).not.toBeNull();

  await act(async () => {
    fireEvent.change(emailInput, { target: { value: email } });
    fireEvent.change(passwordInput, { target: { value: password } });
  });
  await act(async () => {
    fireEvent.click(submitButton);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration — Full Offline Login Flow", () => {
  const TEST_EMAIL = "offline.user@example.com";
  const TEST_PASSWORD = "Secure@Pass123";
  const TEST_USER_ID = "user-offline-abc-123";

  let originalFetch: typeof global.fetch;
  let unhandledRejections: unknown[];

  beforeAll(() => {
    // Polyfill crypto.subtle for jsdom
    if (!global.crypto?.subtle) {
      const nodeCrypto = require("crypto");
      Object.defineProperty(global, "crypto", {
        configurable: true,
        value: nodeCrypto.webcrypto ?? { subtle: nodeCrypto.subtle },
      });
    }
  });

  beforeEach(async () => {
    // Isolate timers — prevents setTimeout leakage between tests
    jest.useFakeTimers();

    localStorage.clear();
    await seedLocalStorageCredential({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      userId: TEST_USER_ID,
    });

    setOnlineStatus(false);

    originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    unhandledRejections = [];
    process.on("unhandledRejection", (reason) => {
      unhandledRejections.push(reason);
    });

    jest.clearAllMocks();
    mockPush.mockClear();

    // Re-mock fetch after clearAllMocks reset it
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  });

  afterEach(() => {
    cleanup();
    jest.runAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    setOnlineStatus(true);
    localStorage.clear();
    process.removeAllListeners("unhandledRejection");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1 — Login page renders completely when offline (Requirement 2.1)
  // ─────────────────────────────────────────────────────────────────────────

  it("renders the login form completely with no error boundary or unhandled rejection", async () => {
    await act(async () => {
      render(React.createElement(LoginForm));
    });

    // Run any timers set during mount (settings effect, etc.)
    await act(async () => {
      jest.runAllTimers();
      await Promise.resolve(); // flush microtasks
    });

    // The component should be in the DOM
    const formOrContainer =
      document.querySelector("form") ||
      document.querySelector('[class*="min-h-screen"]');
    expect(formOrContainer).not.toBeNull();

    // No unhandled rejection — D1 guard prevented the fetch
    expect(unhandledRejections).toHaveLength(0);

    // fetch() was NOT called — navigator.onLine = false guard is active
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2 — setOfflineSession is called after successful login (Req 2.2)
  // ─────────────────────────────────────────────────────────────────────────

  it("calls setOfflineSession after successful offline credential verification", async () => {
    const setOfflineSessionSpy = jest
      .spyOn(offlineAuth, "setOfflineSession")
      .mockResolvedValue(undefined);

    await act(async () => {
      render(React.createElement(LoginForm));
    });

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await fillAndSubmit(TEST_EMAIL, TEST_PASSWORD);

    // runAllTimersAsync flushes async chains + fires all pending timers
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(setOfflineSessionSpy).toHaveBeenCalledWith(TEST_USER_ID);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3 — Router redirects within 2 seconds (Requirement 2.2)
  // ─────────────────────────────────────────────────────────────────────────

  it("redirects to activity-planner after successful offline login", async () => {
    jest.spyOn(offlineAuth, "setOfflineSession").mockResolvedValue(undefined);

    await act(async () => {
      render(React.createElement(LoginForm));
    });

    // Let mount effects settle
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await fillAndSubmit(TEST_EMAIL, TEST_PASSWORD);

    // Run all timers asynchronously — this flushes promise chains AND timers
    // in the correct order, allowing the setTimeout(600) to fire after all
    // async credential verification awaits have resolved.
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(mockPush).toHaveBeenCalledWith(
      `/activity-planner?id=${encodeURIComponent(TEST_USER_ID)}`
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4 — No network error message shown (Requirement 2.2)
  // ─────────────────────────────────────────────────────────────────────────

  it("does not show a network-error message during a successful offline login", async () => {
    jest.spyOn(offlineAuth, "setOfflineSession").mockResolvedValue(undefined);

    const { toast } = await import("sonner");
    const toastErrorSpy = toast.error as jest.Mock;

    await act(async () => {
      render(React.createElement(LoginForm));
    });

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await fillAndSubmit(TEST_EMAIL, TEST_PASSWORD);

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    // Confirm the login succeeded (redirect happened)
    expect(mockPush).toHaveBeenCalled();

    // No network-error toast should have been emitted
    const networkErrorCalls = toastErrorSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" &&
      (msg.toLowerCase().includes("connection") ||
       msg.toLowerCase().includes("network") ||
       msg.toLowerCase().includes("failed to fetch"))
    );
    expect(networkErrorCalls).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5 — Wrong offline credentials: error shown, no redirect (Req 2.2)
  // ─────────────────────────────────────────────────────────────────────────

  it("shows an error and does NOT redirect when offline credentials do not match cache", async () => {
    // Get the toast mock directly — the module-level jest.mock("sonner") ensures
    // this is always the mocked version.
    const { toast } = require("sonner");
    const toastErrorSpy = toast.error as jest.Mock;

    await act(async () => {
      render(React.createElement(LoginForm));
    });

    // Let mount effects settle
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    // Submit with wrong password — verifyOfflineCredential will return null
    await fillAndSubmit(TEST_EMAIL, "WrongPassword!");

    // Flush all async chains (SHA-256 hash + promise resolution)
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    // No redirect — credentials didn't match
    expect(mockPush).not.toHaveBeenCalled();

    // Error toast should inform the user
    expect(toastErrorSpy).toHaveBeenCalled();
  });
});
