"use client";

/* ============================================================================
   OB image viewer — pinch / drag / wheel zoom
   ----------------------------------------------------------------------------
   The signed ROBT form is the approval artifact, so it has to be readable:
   reviewers routinely need to check that all four signature blocks are visible
   and legible. A plain <img> is not enough on a phone.

   Gestures handled: wheel/pinch-trackpad zoom, one-finger drag, two-finger
   pinch, double-tap to toggle, double-tap-drag is intentionally NOT implemented
   (it fights the drag handler and misfires more than it helps).

   Implemented with Pointer Events rather than Touch Events so the same code
   serves touch, mouse and stylus, and so it works in the Capacitor Android/iOS
   WebView the app ships in.
   ========================================================================== */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, ImageOff } from "lucide-react";
import { cx } from "@/app/activity-planner/mint/ui";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_MS = 280;

type Pt = { x: number; y: number };

export default function ObImageViewer({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: string[];
  index: number;
  onClose: () => void;
  onIndexChange?: (i: number) => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Pt>({ x: 0, y: 0 });
  const [broken, setBroken] = useState(false);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef<Map<number, Pt>>(new Map());

  /* Refs mirror scale/offset so gesture maths can read the *current* transform
     synchronously. Reading it from state instead forces a nested
     setScale(() => setOffset(…)), which is not a pure updater and double-applies
     the offset under StrictMode's deliberate double-invocation. */
  const scaleRef = useRef(1);
  const offsetRef = useRef<Pt>({ x: 0, y: 0 });

  // Pristine values for the gesture in progress.
  const start = useRef({ scale: 1, offset: { x: 0, y: 0 }, dist: 0 });
  const lastTap = useRef(0);
  const [gesturing, setGesturing] = useState(false);

  const count = images.length;
  const safeIndex = Math.max(0, Math.min(index, count - 1));

  /** Single commit point for the transform. */
  const apply = useCallback((nextScale: number, nextOffset: Pt) => {
    scaleRef.current = nextScale;
    offsetRef.current = nextOffset;
    setScale(nextScale);
    setOffset(nextOffset);
  }, []);

  const reset = useCallback(() => {
    apply(1, { x: 0, y: 0 });
    setBroken(false);
  }, [apply]);

  // Reset when the caller switches image from outside (thumb strip, arrows).
  useEffect(() => {
    reset();
  }, [index, reset]);

  /* ── Clamp so the image can never be dragged off-screen ──────────────── */
  const clampOffset = useCallback((next: Pt, s: number): Pt => {
    const el = frameRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };

    const rect = el.getBoundingClientRect();
    // The image is laid out to fit; scaling grows it around its centre, so the
    // slack on each axis is half the overflow.
    const slackX = Math.max(0, (rect.width * s - rect.width) / 2);
    const slackY = Math.max(0, (rect.height * s - rect.height) / 2);

    return {
      x: Math.max(-slackX, Math.min(slackX, next.x)),
      y: Math.max(-slackY, Math.min(slackY, next.y)),
    };
  }, []);

  const zoomTo = useCallback(
    (next: number, around?: Pt) => {
      const prev = scaleRef.current;
      const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));

      if (clamped === 1) {
        apply(1, { x: 0, y: 0 });
        return;
      }

      const cur = offsetRef.current;

      // Keep the point under the cursor/fingers anchored while zooming.
      if (around) {
        const el = frameRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const dx = around.x - (rect.left + rect.width / 2);
          const dy = around.y - (rect.top + rect.height / 2);
          const ratio = clamped / prev;
          apply(
            clamped,
            clampOffset({ x: (cur.x - dx) * ratio + dx, y: (cur.y - dy) * ratio + dy }, clamped)
          );
          return;
        }
      }

      apply(clamped, clampOffset(cur, clamped));
    },
    [apply, clampOffset]
  );

  const centreOfPointers = (): Pt => {
    const pts = [...pointers.current.values()];
    const n = pts.length || 1;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / n,
      y: pts.reduce((s, p) => s + p.y, 0) / n,
    };
  };

  const distanceOfPointers = (): number => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return 0;
    const [a, b] = pts;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  /* ── Pointer handlers ─────────────────────────────────────────────────── */

  const onPointerDown = (e: React.PointerEvent) => {
    // Let the browser handle the toolbar buttons.
    if ((e.target as HTMLElement).closest("[data-no-zoom]")) return;

    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      // Double-tap → toggle between fit and 2.5x.
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        zoomTo(scaleRef.current > 1.05 ? 1 : 2.5);
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
      start.current = { scale: scaleRef.current, offset: offsetRef.current, dist: 0 };
      setGesturing(true);
    } else if (pointers.current.size === 2) {
      start.current = { scale: scaleRef.current, offset: offsetRef.current, dist: distanceOfPointers() };
      setGesturing(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) {
      // Pinch.
      const d = distanceOfPointers();
      const base = start.current;
      if (base.dist > 0 && d > 0) {
        zoomTo(base.scale * (d / base.dist), centreOfPointers());
      }
      return;
    }

    if (pointers.current.size === 1 && scaleRef.current > 1) {
      // One-finger pan, only while zoomed in — otherwise the gesture belongs to
      // the page and would make the viewer feel stuck. movementX/Y is the
      // delta since the previous event for this pointer, which is exactly the
      // incremental pan we want.
      const cur = offsetRef.current;
      apply(
        scaleRef.current,
        clampOffset({ x: cur.x + (e.movementX ?? 0), y: cur.y + (e.movementY ?? 0) }, scaleRef.current)
      );
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) start.current.dist = 0;
    if (pointers.current.size === 0) {
      // Re-enable the easing transition now that the gesture has settled.
      setGesturing(false);
      start.current = { scale: scaleRef.current, offset: offsetRef.current, dist: 0 };
    }
  };

  /* ── Wheel / trackpad pinch ───────────────────────────────────────────── */

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo(scaleRef.current * (e.deltaY < 0 ? 1.14 : 0.88), { x: e.clientX, y: e.clientY });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  /* ── Keyboard ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") zoomTo(scaleRef.current * 1.2);
      if (e.key === "-") zoomTo(scaleRef.current / 1.2);
      if (e.key === "0") reset();
      if (e.key === "ArrowRight" && count > 1) onIndexChange?.((safeIndex + 1) % count);
      if (e.key === "ArrowLeft" && count > 1) onIndexChange?.((safeIndex - 1 + count) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomTo, reset, onClose, onIndexChange, count, safeIndex]);

  /* ── Body scroll lock while open ──────────────────────────────────────── */

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const go = (delta: number) => {
    if (count < 2) return;
    onIndexChange?.((safeIndex + delta + count) % count);
  };

  if (count === 0) {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col" style={{ background: "rgba(15,23,42,.94)" }}>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
          <ImageOff size={34} className="text-white/40" />
          <p className="text-[13px] font-bold text-white/70">No image attached to this request.</p>
        </div>
        <button
          data-no-zoom
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-11 h-11 rounded-full flex items-center justify-center bg-white/10 text-white"
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col"
      style={{ background: "rgba(15,23,42,.94)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Signed OB form${count > 1 ? `, image ${safeIndex + 1} of ${count}` : ""}`}
    >
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div
        data-no-zoom
        className="flex-shrink-0 flex items-center gap-2 px-3 pt-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-extrabold text-white truncate">Signed OB form</p>
          <p className="text-[11px] font-semibold text-white/55">
            {count > 1 ? `Image ${safeIndex + 1} of ${count}` : "1 image"}
            {scale > 1.02 ? ` · ${Math.round(scale * 100)}%` : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={() => zoomTo(scale / 1.25)}
          disabled={scale <= MIN_SCALE}
          aria-label="Zoom out"
          className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 text-white disabled:opacity-30"
        >
          <ZoomOut size={18} />
        </button>
        <button
          type="button"
          onClick={() => zoomTo(scale * 1.25)}
          disabled={scale >= MAX_SCALE}
          aria-label="Zoom in"
          className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 text-white disabled:opacity-30"
        >
          <ZoomIn size={18} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close viewer"
          className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 text-white"
        >
          <X size={20} />
        </button>
      </div>

      {/* ── Image stage ──────────────────────────────────────────────────── */}
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={() => zoomTo(scale > 1.05 ? 1 : 2.5)}
        className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden touch-none select-none"
        style={{ cursor: scale > 1 ? "grab" : "zoom-in" }}
      >
        {broken ? (
          <div className="flex flex-col items-center gap-3 px-8 text-center">
            <ImageOff size={34} className="text-white/40" />
            <p className="text-[13px] font-bold text-white/70">
              This image could not be loaded. The link may have expired.
            </p>
            <a
              href={images[safeIndex]}
              target="_blank"
              rel="noopener noreferrer"
              data-no-zoom
              className="text-[12px] font-extrabold text-white underline underline-offset-4"
            >
              Open it directly
            </a>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={images[safeIndex]}
            alt={`Signed OB form, page ${safeIndex + 1} of ${count}`}
            draggable={false}
            onError={() => setBroken(true)}
            className="max-w-full max-h-full object-contain"
            style={{
              transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
              // Easing only when the finger is up — during a gesture the image
              // has to track the pointer exactly or it feels like lag.
              transition: gesturing ? "none" : "transform .18s cubic-bezier(.22,1,.36,1)",
              willChange: "transform",
            }}
          />
        )}

        {/* Arrows */}
        {count > 1 && !broken && (
          <>
            <button
              data-no-zoom
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous image"
              className={cx(
                "absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center",
                "bg-black/45 text-white backdrop-blur-sm active:scale-95"
              )}
            >
              <ChevronLeft size={22} />
            </button>
            <button
              data-no-zoom
              type="button"
              onClick={() => go(1)}
              aria-label="Next image"
              className={cx(
                "absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center",
                "bg-black/45 text-white backdrop-blur-sm active:scale-95"
              )}
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      {/* ── Thumb strip ──────────────────────────────────────────────────── */}
      {count > 1 && (
        <div
          data-no-zoom
          className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-3 overflow-x-auto"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => onIndexChange?.(i)}
              aria-label={`View image ${i + 1}`}
              aria-current={i === safeIndex}
              className={cx(
                "w-12 h-12 rounded-[10px] overflow-hidden shrink-0 transition-all",
                i === safeIndex ? "ring-2 ring-white scale-105" : "opacity-45"
              )}
              style={{ border: "1px solid rgba(255,255,255,.25)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}