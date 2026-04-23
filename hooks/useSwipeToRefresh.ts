// hooks/useSwipeToRefresh.ts
// Pull-down-to-refresh gesture for mobile.
// Returns a ref to attach to the scrollable container and the current pull state.

"use client";

import { useRef, useState, useCallback, useEffect } from "react";

const THRESHOLD    = 72;  // px to pull before triggering refresh
const MAX_PULL     = 100; // max visual pull distance
const RESISTANCE   = 2.5; // makes the pull feel elastic

export interface SwipeToRefreshState {
  containerRef: React.RefObject<HTMLDivElement | null>;
  pullDistance: number;   // 0–MAX_PULL, for animating the indicator
  isRefreshing: boolean;
}

export function useSwipeToRefresh(
  onRefresh: () => Promise<void> | void,
  enabled = true
): SwipeToRefreshState {
  const containerRef  = useRef<HTMLDivElement | null>(null);
  const startYRef     = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const el = containerRef.current;
    if (!el || !enabled) return;
    // Only trigger if scrolled to top
    if (el.scrollTop > 0) return;
    startYRef.current = e.touches[0].clientY;
  }, [enabled]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (startYRef.current === null || isRefreshing) return;
    const delta = e.touches[0].clientY - startYRef.current;
    if (delta <= 0) { setPullDistance(0); return; }

    // Elastic resistance
    const pull = Math.min(delta / RESISTANCE, MAX_PULL);
    setPullDistance(pull);

    // Prevent page scroll while pulling
    if (pull > 5) e.preventDefault();
  }, [isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (startYRef.current === null) return;
    startYRef.current = null;

    if (pullDistance >= THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(THRESHOLD); // hold at threshold while refreshing
      if ("vibrate" in navigator) navigator.vibrate(30);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove",  handleTouchMove,  { passive: false });
    el.addEventListener("touchend",   handleTouchEnd,   { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove",  handleTouchMove);
      el.removeEventListener("touchend",   handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, enabled]);

  return { containerRef, pullDistance, isRefreshing };
}
