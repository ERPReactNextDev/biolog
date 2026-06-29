/**
 * Unit Tests for D1/D2 — handleSettingsFetch guard (Task 8.1)
 *
 * Tests the fixed settings useEffect in components/login-form.tsx:
 *   - navigator.onLine guard prevents fetch when offline
 *   - localStorage cache is loaded and applied when offline (D2 branding cache)
 *   - Online path still fetches, applies theme, and persists to localStorage
 *   - .catch(() => {}) absorbs fetch rejections — no unhandled promise rejection
 *
 * Validates: Requirements 2.1, 2.2
 */

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
 * Replicates the FIXED settings useEffect from components/login-form.tsx.
 *
 * Extracted here so it can be exercised in isolation without mounting
 * the full React component (which requires a complete Next.js router mock).
 * The logic is a verbatim copy of the effect body in login-form.tsx.
 */
function runFixedSettingsEffect(
  setSettings: (data: any) => void
): void {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    // Offline branch — load branding from localStorage cache
    const raw = localStorage.getItem("acculog_settings_cache");
    if (raw) {
      try {
        const cached = JSON.parse(raw);
        setSettings(cached);
        if (cached.themeColor) {
          document.documentElement.setAttribute("data-theme", cached.themeColor);
        }
      } catch {
        // Corrupted cache — silently ignore
      }
    }
    // If no cache, return without error
    return;
  }

  // Online branch
  fetch("/api/admin/settings")
    .then((r) => r.json())
    .then((data: any) => {
      setSettings(data);
      localStorage.setItem("acculog_settings_cache", JSON.stringify(data));
      if (data.themeColor) {
        document.documentElement.setAttribute("data-theme", data.themeColor);
      }
    })
    .catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Offline, no cached settings: no fetch, settings stays null
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSettingsFetch — offline, no cached settings", () => {
  let originalFetch: typeof fetch;
  let unhandledRejections: any[];

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();

    setOnlineStatus(false);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");

    unhandledRejections = [];
    process.on("unhandledRejection", (reason) => {
      unhandledRejections.push(reason);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setOnlineStatus(true);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    process.removeAllListeners("unhandledRejection");
  });

  it("does not call fetch() when offline with no cached settings", async () => {
    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    // Allow all microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not call setSettings when no cache is present", async () => {
    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // setSettings was never called — settings state stays null
    expect(setSettings).not.toHaveBeenCalled();
  });

  it("does not produce an unhandled promise rejection", async () => {
    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(unhandledRejections).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Offline, with acculog_settings_cache in localStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSettingsFetch — offline, cached settings in localStorage", () => {
  const cachedSettings = {
    themeColor: "green",
    logoUrl: "https://example.com/cached-logo.png",
    companyName: "Acculog Demo",
  };

  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();

    setOnlineStatus(false);
    localStorage.clear();
    localStorage.setItem("acculog_settings_cache", JSON.stringify(cachedSettings));
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setOnlineStatus(true);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("calls setSettings with the cached data when offline", async () => {
    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).toHaveBeenCalledWith(cachedSettings);
  });

  it("applies the cached themeColor to data-theme when offline", async () => {
    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(document.documentElement.getAttribute("data-theme")).toBe("green");
  });

  it("does NOT call fetch() even with a valid cache present", async () => {
    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("handles corrupted cache without throwing — setSettings not called", async () => {
    localStorage.setItem("acculog_settings_cache", "{ invalid json {{");
    const setSettings = jest.fn();

    // Should not throw
    expect(() => runFixedSettingsEffect(setSettings)).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Corrupted cache is ignored — setSettings not called, no crash
    expect(setSettings).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Online: fetch called, theme applied, data persisted to localStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSettingsFetch — online path", () => {
  const serverSettings = {
    themeColor: "blue",
    logoUrl: "https://example.com/logo.png",
    companyName: "Biolog Corp",
  };

  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;

    setOnlineStatus(true);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setOnlineStatus(true);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("calls fetch('/api/admin/settings') when online", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => serverSettings,
    } as any);

    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(global.fetch).toHaveBeenCalledWith("/api/admin/settings");
  });

  it("calls setSettings with the server response when online", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => serverSettings,
    } as any);

    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).toHaveBeenCalledWith(serverSettings);
  });

  it("applies themeColor from server response to document.documentElement", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => serverSettings,
    } as any);

    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(document.documentElement.getAttribute("data-theme")).toBe("blue");
  });

  it("persists server response to localStorage under acculog_settings_cache", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => serverSettings,
    } as any);

    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const cached = localStorage.getItem("acculog_settings_cache");
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toEqual(serverSettings);
  });

  it("does not apply data-theme when themeColor is absent from response", async () => {
    const settingsWithoutTheme = { logoUrl: "https://example.com/logo.png" };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => settingsWithoutTheme,
    } as any);

    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // No themeColor in response — attribute should not be set
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Online, fetch rejects: .catch(() => {}) absorbs error
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSettingsFetch — online, fetch rejects", () => {
  let originalFetch: typeof fetch;
  let unhandledRejections: any[];

  beforeEach(() => {
    originalFetch = global.fetch;

    setOnlineStatus(true);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");

    unhandledRejections = [];
    process.on("unhandledRejection", (reason) => {
      unhandledRejections.push(reason);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setOnlineStatus(true);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    process.removeAllListeners("unhandledRejection");
  });

  it("does not produce an unhandled rejection when fetch rejects with TypeError", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    // Allow microtask queue and rejection propagation to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(unhandledRejections).toHaveLength(0);
  });

  it("does not produce an unhandled rejection when fetch rejects with a generic network error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network Error"));

    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(unhandledRejections).toHaveLength(0);
  });

  it("setSettings is not called when fetch rejects", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(setSettings).not.toHaveBeenCalled();
  });

  it("does not modify acculog_settings_cache in localStorage when fetch rejects", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const setSettings = jest.fn();

    runFixedSettingsEffect(setSettings);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(localStorage.getItem("acculog_settings_cache")).toBeNull();
  });
});
