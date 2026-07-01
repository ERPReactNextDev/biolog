/**
 * @jest-environment jsdom
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import PWADiagnosticsPanel from "@/components/pwa-diagnostics-panel";

function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

describe("PWA diagnostics panel", () => {
  const originalServiceWorker = navigator.serviceWorker;
  const originalCaches = global.caches;
  let serviceWorkerMock: {
    controller: { scriptURL: string } | null;
    getRegistration: jest.Mock;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
  };

  beforeEach(() => {
    setOnlineStatus(false);

    serviceWorkerMock = {
      controller: {
        scriptURL: "https://example.com/service-worker.js",
      },
      getRegistration: jest.fn().mockResolvedValue({
        scope: "https://example.com/",
        active: { scriptURL: "https://example.com/service-worker.js" },
        waiting: null,
        installing: null,
      }),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      get: () => serviceWorkerMock,
    });

    Object.defineProperty(global, "caches", {
      configurable: true,
      value: {
        keys: jest.fn().mockResolvedValue(["acculog-cache-v15", "acculog-runtime-static-v3"]),
        open: jest.fn().mockResolvedValue({
          match: jest.fn().mockImplementation(async (request: string) => {
            if (
              request === "/activity-planner" ||
              request === "http://localhost/activity-planner"
            ) {
              return { ok: true };
            }
            return undefined;
          }),
        }),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });

    Object.defineProperty(global, "caches", {
      configurable: true,
      value: originalCaches,
    });

    setOnlineStatus(true);
  });

  it("shows service worker control, cache names, and whether /activity-planner is cached", async () => {
    await act(async () => {
      render(<PWADiagnosticsPanel />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("pwa-online-status")).toHaveTextContent("no");
    });

    fireEvent.click(screen.getByLabelText(/toggle pwa diagnostics/i));

    await waitFor(() => {
      expect(screen.getByTestId("pwa-active-worker-value")).toHaveTextContent("/service-worker.js");
      expect(screen.getByTestId("pwa-cache-names")).toHaveTextContent("acculog-cache-v15");
      expect(screen.getByTestId("pwa-cache-names")).toHaveTextContent("acculog-runtime-static-v3");
      expect(screen.getByTestId("pwa-activity-planner-cached")).toHaveTextContent("yes");
    });
  });
});
