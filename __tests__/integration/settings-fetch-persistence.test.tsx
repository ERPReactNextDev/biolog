/**
 * Integration Test — Settings Fetch Online: Persistence (Task 9.5)
 *
 * Validates that when navigator.onLine = true, the LoginForm:
 *   1. Fetches /api/admin/settings and applies the themeColor to
 *      document.documentElement as "data-theme"
 *   2. Persists the full response to localStorage under key
 *      "acculog_settings_cache"
 *
 * Validates: Requirements 2.1, 3.1
 */

import React from "react";
import { render, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

import { LoginForm } from "@/components/login-form";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level mocks
// ─────────────────────────────────────────────────────────────────────────────

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration — Settings Fetch Online: Persistence", () => {
  const MOCK_SETTINGS = {
    themeColor: "blue",
    logoUrl: "https://example.com/logo.png",
  };

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();

    // Remove any previously applied data-theme attribute
    document.documentElement.removeAttribute("data-theme");

    setOnlineStatus(true);

    originalFetch = global.fetch;
    // Mock fetch: only /api/admin/settings returns the settings payload;
    // all other paths fall through with a generic 200.
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url === "/api/admin/settings") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(MOCK_SETTINGS),
        } as Response);
      }
      // Default stub for any other fetch calls the component may make
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    });

    jest.clearAllMocks();
    // Re-apply the fetch mock since clearAllMocks resets mock implementations
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url === "/api/admin/settings") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(MOCK_SETTINGS),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    });
  });

  afterEach(() => {
    cleanup();
    jest.runAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    setOnlineStatus(true);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1 — themeColor applied to document.documentElement (Requirement 3.1)
  // ─────────────────────────────────────────────────────────────────────────

  it("applies themeColor from /api/admin/settings to document.documentElement[data-theme]", async () => {
    await act(async () => {
      render(React.createElement(LoginForm));
    });

    // Flush the settings fetch effect and its .then() chain
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("blue");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2 — Settings persisted to localStorage (Requirements 2.1, 3.1)
  // ─────────────────────────────────────────────────────────────────────────

  it("persists the settings response to localStorage under acculog_settings_cache", async () => {
    await act(async () => {
      render(React.createElement(LoginForm));
    });

    // Flush the settings fetch effect and its .then() chain
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    const raw = localStorage.getItem("acculog_settings_cache");
    expect(raw).not.toBeNull();

    const cached = JSON.parse(raw!);
    expect(cached).toMatchObject({
      themeColor: "blue",
      logoUrl: "https://example.com/logo.png",
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3 — fetch was called for /api/admin/settings (Requirement 3.1)
  // ─────────────────────────────────────────────────────────────────────────

  it("calls fetch('/api/admin/settings') when navigator.onLine is true", async () => {
    await act(async () => {
      render(React.createElement(LoginForm));
    });

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    const settingsCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "/api/admin/settings"
    );
    expect(settingsCalls.length).toBeGreaterThanOrEqual(1);
  });
});
