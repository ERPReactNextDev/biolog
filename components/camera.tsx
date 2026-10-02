"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as faceapi from "face-api.js";
import { toast } from "sonner";
import { RefreshCcw, SwitchCamera, Camera as CameraIcon, CheckCircle2, AlertCircle, Maximize2, Minimize2 } from "lucide-react";
import { getPreferences } from "@/lib/preferences";

interface CameraProps {
  onCaptureAction: (dataUrl: string, faceData?: any) => void;
  onRegisterAction?: (descriptors: number[][]) => void;
  mode?: "capture" | "register";
  registeredDescriptors?: number[][];
  skipFaceVerification?: boolean;
}

// Fallback default — overridden at runtime by user preferences
const DEFAULT_COUNTDOWN_SECONDS = 10;

type FaceStatus = "idle" | "no-face" | "multiple" | "detected" | "unsupported";

export default function Camera({
  onCaptureAction,
  onRegisterAction,
  mode = "capture",
  registeredDescriptors,
  skipFaceVerification = false,
}: CameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const modelsLoadedRef = useRef(false);
  const recognitionAvailableRef = useRef(false);
  const faceMatcherRef = useRef<faceapi.FaceMatcher | null>(null);

  // ── Use refs for values accessed inside the RAF loop to avoid stale closures ──
  const faceStatusRef = useRef<FaceStatus>("idle");
  const isMatchRef = useRef<boolean | null>(null);
  const lastDetectionsRef = useRef<any[]>([]);
  const registrationTakesRef = useRef<number[][]>([]);
  const registrationStepRef = useRef<number>(0);
  const modeRef = useRef(mode);
  const registeredDescriptorsRef = useRef(registeredDescriptors);
  const skipFaceVerificationRef = useRef(skipFaceVerification);
  /** The preview box itself — the element we ask to go fullscreen. */
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Keep refs in sync with props/state
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { registeredDescriptorsRef.current = registeredDescriptors; }, [registeredDescriptors]);
  useEffect(() => { skipFaceVerificationRef.current = skipFaceVerification; }, [skipFaceVerification]);

  // ── UI state (only for rendering) ──
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [permissionGiven, setPermissionGiven] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("idle");
  const [isMatch, setIsMatch] = useState<boolean | null>(null);
  const [registrationStep, setRegistrationStep] = useState<number>(0);
  const [registrationTakesCount, setRegistrationTakesCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sync ref → state for rendering
  const updateFaceStatus = useCallback((s: FaceStatus) => {
    faceStatusRef.current = s;
    setFaceStatus(s);
  }, []);

  const updateIsMatch = useCallback((v: boolean | null) => {
    isMatchRef.current = v;
    setIsMatch(v);
  }, []);

  // ── Landmark helpers ──
  const getNormalizedLandmarks = useCallback((det: any): number[] | null => {
    if (!det.landmarks) return null;
    const box = det.detection.box;
    const points: number[] = [];
    (det.landmarks.positions as { x: number; y: number }[]).forEach((p) => {
      points.push((p.x - box.x) / box.width);
      points.push((p.y - box.y) / box.height);
    });
    return points;
  }, []);

  const compareLandmarks = useCallback((current: number[], registered: number[][]): boolean => {
    if (registered.length === 0) return false;
    return registered.some((reg) => {
      if (reg.length !== current.length) return false;
      let sumSq = 0;
      for (let i = 0; i < current.length; i++) sumSq += Math.pow(current[i] - reg[i], 2);
      return Math.sqrt(sumSq) < 0.5;
    });
  }, []);

  // ── Initialize FaceMatcher when descriptors change ──
  useEffect(() => {
    if (registeredDescriptors && registeredDescriptors.length > 0) {
      const isFullDescriptor = registeredDescriptors[0].length === 128;
      if (isFullDescriptor && recognitionAvailableRef.current) {
        try {
          const labeled = new faceapi.LabeledFaceDescriptors(
            "user",
            registeredDescriptors.map((d) => new Float32Array(d))
          );
          faceMatcherRef.current = new faceapi.FaceMatcher(labeled, 0.6);
        } catch {
          /* silent */
        }
      } else {
        faceMatcherRef.current = null;
      }
    } else {
      faceMatcherRef.current = null;
    }
  }, [registeredDescriptors]);

  // ── Face detection loop (uses refs, never re-created) ──
  const runFaceDetection = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;

    if (!video || !overlay || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runFaceDetection);
      return;
    }

    const ctx = overlay.getContext("2d");
    if (!ctx) { rafRef.current = requestAnimationFrame(runFaceDetection); return; }

    overlay.width = video.videoWidth || video.clientWidth;
    overlay.height = video.videoHeight || video.clientHeight;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // If skipFaceVerification is true, don't do face detection
    if (skipFaceVerificationRef.current) {
      updateFaceStatus("idle");
      updateIsMatch(null);
      rafRef.current = requestAnimationFrame(runFaceDetection);
      return;
    }

    if (!modelsLoadedRef.current) {
      rafRef.current = requestAnimationFrame(runFaceDetection);
      return;
    }

    try {
      let task = faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks();

      if (recognitionAvailableRef.current) {
        (task as any) = (task as any).withFaceDescriptors();
      }

      const detections = await task;
      lastDetectionsRef.current = detections;

      if (detections.length === 0) {
        updateFaceStatus("no-face");
        updateIsMatch(null);
      } else if (detections.length > 1) {
        updateFaceStatus("multiple");
        updateIsMatch(null);
        detections.forEach((det: any) => {
          const { x, y, width, height } = det.detection.box;
          const scaleX = overlay.width / video.videoWidth;
          const scaleY = overlay.height / video.videoHeight;
          // Mint-rust accent for the "multiple faces" warning box
          ctx.strokeStyle = "#D4724A";
          ctx.lineWidth = 2;
          ctx.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY);
        });
      } else {
        updateFaceStatus("detected");
        const det = detections[0] as any;
        const currentMode = modeRef.current;
        const currentDescriptors = registeredDescriptorsRef.current;

        // ── Identity verification ──
        if (currentMode === "capture" && currentDescriptors && currentDescriptors.length > 0) {
          const isFullDescriptor = currentDescriptors[0].length === 128;
          if (isFullDescriptor && faceMatcherRef.current && recognitionAvailableRef.current && det.descriptor) {
            const best = faceMatcherRef.current.findBestMatch(det.descriptor);
            updateIsMatch(best.label !== "unknown");
          } else {
            const lm = getNormalizedLandmarks(det);
            if (lm) updateIsMatch(compareLandmarks(lm, currentDescriptors));
          }
        } else if (currentMode === "capture") {
          updateIsMatch(false);
        }

        // ── Draw face frame ──
        const currentIsMatch = isMatchRef.current;
        const { x, y, width, height } = det.detection.box;
        const scaleX = overlay.width / video.videoWidth;
        const scaleY = overlay.height / video.videoHeight;
        const fx = x * scaleX, fy = y * scaleY, fw = width * scaleX, fh = height * scaleY;
        const pad = 20;
        const px = fx - pad, py = fy - pad, pw = fw + pad * 2, ph = fh + pad * 2;
        const corner = 18;

        const isGreen = currentMode === "register" || currentIsMatch === true || currentIsMatch === null;
        // Face box: mint when verified, red only on a genuine mismatch
        const statusColor = isGreen ? "#0D9669" : "#DC2626";
        const statusBg = isGreen ? "rgba(13,150,105,0.08)" : "rgba(220,38,38,0.08)";

        ctx.fillStyle = statusBg;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, corner);
        ctx.fill();

        ctx.strokeStyle = statusColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, corner);
        ctx.stroke();

        const len = 18, lw = 3;
        ctx.strokeStyle = statusColor;
        ctx.lineWidth = lw;
        ctx.lineCap = "round";

        [
          [px, py + len, px, py, px + len, py],
          [px + pw - len, py, px + pw, py, px + pw, py + len],
          [px, py + ph - len, px, py + ph, px + len, py + ph],
          [px + pw - len, py + ph, px + pw, py + ph, px + pw, py + ph - len],
        ].forEach(([x1, y1, x2, y2, x3, y3]) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineTo(x3, y3);
          ctx.stroke();
        });

        // Scan line
        const t = ((performance.now() % 2000) / 2000);
        const scanY = py + t * ph;
        const grad = ctx.createLinearGradient(px, scanY - 8, px, scanY + 8);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.5, isGreen ? "rgba(26,122,74,0.35)" : "rgba(204,19,24,0.35)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(px, scanY - 8, pw, 16);
      }
    } catch {
      updateFaceStatus("unsupported");
    }

    rafRef.current = requestAnimationFrame(runFaceDetection);
  }, [updateFaceStatus, updateIsMatch, getNormalizedLandmarks, compareLandmarks]);

  // ── Load models once ──
  useEffect(() => {
    const loadModels = async () => {
      const MODEL_URL = "/models";
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(`${MODEL_URL}/tiny_face_detector`),
          faceapi.nets.faceLandmark68Net.loadFromUri(`${MODEL_URL}/face_landmark68`),
        ]);
        modelsLoadedRef.current = true;
        try {
          await faceapi.nets.faceRecognitionNet.loadFromUri(`${MODEL_URL}/face_recognition`);
          recognitionAvailableRef.current = true;
        } catch {
          /* fallback to landmark mode */
        }
        try {
          await faceapi.nets.faceExpressionNet.loadFromUri(`${MODEL_URL}/face_expression`);
        } catch (_) {}
      } catch {
        updateFaceStatus("unsupported");
      }
    };
    loadModels();
  }, [updateFaceStatus]);

  // ── Start/stop RAF loop ──
  useEffect(() => {
    if (permissionGiven && cameraStarted && !capturedImage) {
      rafRef.current = requestAnimationFrame(runFaceDetection);
    }
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [permissionGiven, cameraStarted, capturedImage, runFaceDetection]);

  // ── Camera control ──
  const startCamera = async (deviceId?: string) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const constraints: MediaStreamConstraints = deviceId
      ? { video: { deviceId: { exact: deviceId }, facingMode: "user" } }
      : { video: { facingMode: "user" } };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) videoRef.current.srcObject = stream;
      streamRef.current = stream;
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (videoRef.current) videoRef.current.srcObject = stream;
        streamRef.current = stream;
      } catch { /* silent */ }
    }
  };

  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setPermissionGiven(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
      streamRef.current = stream;
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = all.filter((d) => d.kind === "videoinput");
      setDevices(videoDevices);
      if (videoDevices.length > 0) setSelectedDevice(videoDevices[0].deviceId);
      setCameraStarted(true);
    } catch (e: any) {
      if (e.name === "NotAllowedError") alert("Camera access denied. Please enable it in browser settings.");
      else if (e.name === "NotFoundError") alert("No camera found on this device.");
      else alert("Could not start camera. Please refresh and try again.");
    }
  };

  useEffect(() => {
    const checkPermission = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        if (devs.some((d) => d.kind === "videoinput" && d.label !== "")) requestPermission();
      } catch (_) {}
    };
    checkPermission();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!permissionGiven || !cameraStarted || !selectedDevice) return;
    startCamera(selectedDevice);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice, permissionGiven, cameraStarted]);

  const toggleFullscreen = async () => {
    const el = previewRef.current;
    if (!el) return;

    try {
      // ── Leaving fullscreen ────────────────────────────────────────────────
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
        return;
      }

      // ── Entering ──────────────────────────────────────────────────────────
      // Fullscreen the PREVIEW BOX, not <html>. Fullscreening the document
      // left the camera as a letterboxed strip with the rest of the app around
      // it. The browser puts a fullscreened element in its own top layer, so
      // this also sidesteps the drawer's z-index and containing block.
      const canUseApi =
        typeof el.requestFullscreen === "function" ||
        typeof (el as any).webkitRequestFullscreen === "function";

      if (canUseApi) {
        try {
          const req = el.requestFullscreen ?? (el as any).webkitRequestFullscreen;
          await req.call(el);
          setIsFullscreen(true);
          return;
        } catch {
          // Denied (iOS Safari has no API; some webviews block it) — fall
          // through to the CSS overlay below.
        }
      }

      // ── Fallback: iOS Safari / webview, where there is no Fullscreen API.
      // A fixed overlay is only viewport-relative while no ancestor has a
      // transform, so keep z-index above Radix's z-50 portal.               ──
      setIsFullscreen(true);
    } catch (err) {
      console.error("Error toggling fullscreen:", err);
      setIsFullscreen(false);
      toast.error("Couldn't open fullscreen.");
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  /* Escape closes the CSS fallback. Native fullscreen handles its own Escape,
     and on some Android builds it does not fire keydown, so only act when we
     are NOT in a native fullscreen element. */
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  /* Never leave an orphaned overlay behind when the drawer unmounts. */
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  const flipCamera = () => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === selectedDevice);
    setSelectedDevice(devices[(idx + 1) % devices.length].deviceId);
  };

  // ── Registration take ──
  const registerTake = useCallback(() => {
    const detections = lastDetectionsRef.current;
    if (detections.length === 0 || registrationTakesRef.current.length >= 3) return;
    const det = detections[0] as any;
    const normalizedPoints = getNormalizedLandmarks(det);
    if (!normalizedPoints) { toast.error("Landmarks not found. Try again."); return; }

    const newTakes = [...registrationTakesRef.current, normalizedPoints];
    registrationTakesRef.current = newTakes;

    if (newTakes.length < 3) {
      const nextStep = newTakes.length;
      registrationStepRef.current = nextStep;
      setRegistrationStep(nextStep);
      setRegistrationTakesCount(newTakes.length);
      const hints = ["Harap sa gitna (Center)", "Lumingon sa kaliwa (Left)", "Lumingon sa kanan (Right)"];
      toast.success(`Take ${newTakes.length}/3 captured! Ngayon, ${hints[nextStep]}.`);
    } else {
      setRegistrationTakesCount(3);
      toast.success("Face registration complete!");
      onRegisterAction?.(newTakes);
    }
  }, [getNormalizedLandmarks, onRegisterAction]);

  // ── Tap to capture/register ──
  const handleTap = useCallback(() => {
    const currentFaceStatus = faceStatusRef.current;
    const currentIsMatch = isMatchRef.current;
    const currentMode = modeRef.current;
    const currentDescriptors = registeredDescriptorsRef.current;

    if (capturedImage || countdown !== null) return;

    const canCapture = skipFaceVerification || currentFaceStatus === "detected" || currentFaceStatus === "unsupported";
    if (!canCapture) return;

    if (currentMode === "register") {
      registerTake();
      return;
    }

    // capture mode checks - skip if face verification is disabled
    if (!skipFaceVerification) {
      const isRegistered = currentDescriptors && currentDescriptors.length > 0;
      if (!isRegistered) {
        toast.error("Biometrics not registered! Please register your face first.");
        return;
      }
      if (faceMatcherRef.current && currentIsMatch === false) {
        toast.error("Identity mismatch! Please ensure you are the registered user.");
        return;
      }
    }

    // Read timer prefs at tap-time so it always reflects the latest setting
    const timerPrefs = getPreferences();
    const seconds = timerPrefs.cameraTimerEnabled
      ? (timerPrefs.cameraTimerSeconds ?? DEFAULT_COUNTDOWN_SECONDS)
      : 0;
    setCountdown(seconds);
  }, [capturedImage, countdown, registerTake, skipFaceVerification]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { capture(); return; }
    const t = setTimeout(() => setCountdown((p) => (p! > 0 ? p! - 1 : 0)), 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedImage(dataUrl);

    let faceData = null;
    const dets = lastDetectionsRef.current;
    if (dets.length > 0) {
      const det = dets[0];
      const box = det.detection ? det.detection.box : (det as any).box;
      const score = det.detection ? det.detection.score : (det as any).score;
      faceData = { box: { x: box.x, y: box.y, width: box.width, height: box.height }, score };
    }

    onCaptureAction(dataUrl, faceData);
    setCountdown(null);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [onCaptureAction]);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setCountdown(null);
    updateFaceStatus("idle");
    updateIsMatch(null);
    setRegistrationStep(0);
    setRegistrationTakesCount(0);
    registrationTakesRef.current = [];
    registrationStepRef.current = 0;
    lastDetectionsRef.current = [];
    if (selectedDevice) startCamera(selectedDevice);
    setTimeout(() => {
      rafRef.current = requestAnimationFrame(runFaceDetection);
    }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice, runFaceDetection, updateFaceStatus, updateIsMatch]);

  // ── Status config ──
  const registrationGuidance = [
    { label: "Harap sa gitna (Center)", icon: "👤" },
    { label: "Lumingon sa kaliwa (Left)", icon: "⬅️" },
    { label: "Lumingon sa kanan (Right)", icon: "➡️" },
  ];

  const getStatusLabel = () => {
    if (skipFaceVerification) return "Tap to capture";
    if (faceStatus === "idle") return "Starting camera…";
    if (faceStatus === "unsupported") return "Tap to capture";
    if (faceStatus === "no-face") return "No face detected";
    if (faceStatus === "multiple") return "Multiple faces detected";
    if (faceStatus === "detected") {
      if (mode === "register") {
        const step = Math.min(registrationStep, 2);
        return `${registrationGuidance[step].icon} Step ${registrationTakesCount + 1}/3: ${registrationGuidance[step].label}`;
      }
      const isRegistered = registeredDescriptors && registeredDescriptors.length > 0;
      if (!isRegistered) return "User not registered — capture blocked";
      if (isMatch === null) return "Face detected — verifying identity…";
      if (isMatch) return "Identity verified — tap to capture";
      return "Identity mismatch!";
    }
    return "";
  };

  const isGreenStatus =
    faceStatus === "detected" &&
    (mode === "register" || isMatch === true || isMatch === null);

  // Mint status tokens — same palette as the rest of the Calm Mint system
  const statusColor = isGreenStatus
    ? "var(--mint-strong)"
    : faceStatus === "multiple"
      ? "var(--clay-ink)"
      : faceStatus === "no-face"
        ? "var(--alert-ink)"
        : faceStatus === "detected"
          ? "var(--alert-ink)"
          : "var(--text-muted)";

  const statusBg = isGreenStatus
    ? "var(--mint-soft)"
    : faceStatus === "multiple"
      ? "var(--clay-soft)"
      : faceStatus === "no-face"
        ? "var(--alert-soft)"
        : faceStatus === "detected"
          ? "var(--alert-soft)"
          : "var(--bg)";

  const canTap = skipFaceVerification || faceStatus === "detected" || faceStatus === "unsupported";

  return (
    <div className="mint-ui w-full flex flex-col gap-3">
      {/* Permission prompt */}
      {!permissionGiven && (
        <button
          onClick={requestPermission}
          className="mint-tap w-full rounded-[var(--r-card-lg)] border-2 border-dashed py-8 flex flex-col items-center gap-3 transition-colors group"
          style={{ borderColor: "var(--border-strong)", background: "var(--card-alt)" }}
        >
          <div
            className="w-14 h-14 rounded-[18px] flex items-center justify-center transition-colors group-hover:bg-[var(--mint-btn)]"
            style={{ background: "var(--mint-soft)" }}
          >
            <CameraIcon
              size={24}
              className="transition-colors group-hover:text-white"
              style={{ color: "var(--mint)" }}
            />
          </div>
          <div className="text-center">
            <p className="text-[13.5px] font-extrabold text-[var(--text)]">Start Camera</p>
            <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
              Tap to allow camera access — your face is verified, never stored as a photo
            </p>
          </div>
        </button>
      )}

      {/* Live camera */}
      {permissionGiven && !capturedImage && (
        <>
          {!skipFaceVerification && faceStatus !== "idle" && (
            <div
              className="flex items-center gap-2 rounded-[var(--r-card)] px-3.5 py-2.5"
              style={{ background: statusBg }}
            >
              {(faceStatus === "no-face" ||
                faceStatus === "multiple" ||
                (faceStatus === "detected" && !isGreenStatus)) && (
                <AlertCircle size={14} style={{ color: statusColor }} className="shrink-0" />
              )}
              {faceStatus === "detected" && isGreenStatus && (
                <CheckCircle2 size={14} style={{ color: statusColor }} className="shrink-0" />
              )}
              <span
                className="text-[12px] font-extrabold flex-1"
                style={{ color: statusColor }}
              >
                {getStatusLabel()}
              </span>
              {faceStatus === "detected" && (
                <span
                  className="w-2 h-2 rounded-full animate-pulse-soft shrink-0"
                  style={{ background: statusColor }}
                />
              )}
            </div>
          )}

          <div
            ref={previewRef}
            className={`relative w-full select-none overflow-hidden bg-black transition-all ${canTap ? "cursor-pointer active:scale-[0.995]" : "cursor-not-allowed"} ${isFullscreen ? "fixed inset-0 z-[9999] rounded-none" : "rounded-[var(--r-card-lg)]"}`}
            onClick={handleTap}
            onTouchStart={(e) => { e.preventDefault(); handleTap(); }}
            style={{
              // 100dvh tracks the mobile URL bar; 100vh would overflow and
              // leave a black strip when the bar collapses.
              height: isFullscreen ? "100dvh" : undefined,
              aspectRatio: isFullscreen ? undefined : "4/3",
              border: isFullscreen ? undefined : "1px solid var(--border)",
            }}
          >
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {!skipFaceVerification && <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />}

            {/* Fullscreen toggle — 44px minimum touch target */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleFullscreen();
              }}
              aria-label={isFullscreen ? "Exit full screen" : "Open full screen"}
              className={`absolute z-10 rounded-full flex items-center gap-1.5 backdrop-blur-sm transition-colors active:scale-95 ${isFullscreen ? "top-4 right-4 h-11 px-4" : "top-3 right-3 h-11 w-11 justify-center"}`}
              style={{
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.28)",
              }}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 size={16} />
                  <span className="text-[12.5px] font-extrabold">Exit</span>
                </>
              ) : (
                <Maximize2 size={17} />
              )}
            </button>

            {countdown !== null && countdown > 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="flex flex-col items-center gap-2">
                  <span
                    className="font-black leading-none"
                    style={{ fontSize: 72, color: "var(--mint)", textShadow: "0 0 32px rgba(13,150,105,.6)" }}
                  >
                    {countdown}
                  </span>
                  <span className="text-white/80 text-[13px] font-bold tracking-wide">
                    Capturing…
                  </span>
                </div>
              </div>
            )}

            {countdown === null && (skipFaceVerification || faceStatus === "unsupported" || faceStatus === "idle") && (
              <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
                <div className="bg-black/50 rounded-full px-4 py-2">
                  <span className="text-white text-[12px] font-medium">Tap to capture</span>
                </div>
              </div>
            )}

            {!skipFaceVerification && countdown === null && faceStatus === "detected" && (
              <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
                <div
                  className="rounded-full px-4 py-2 flex items-center gap-2 shadow-lg"
                  style={{ background: isGreenStatus ? "rgba(11,127,90,.9)" : "rgba(185,28,28,.9)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse-soft" />
                  <span className="text-white text-[12px] font-bold">
                    {mode === "register"
                      ? `Tap to take photo ${registrationTakesCount + 1}/3`
                      : !(registeredDescriptors && registeredDescriptors.length > 0)
                        ? "User not registered"
                        : isMatch === false
                          ? "Identity mismatch!"
                          : "Tap to capture"}
                  </span>
                </div>
              </div>
            )}

            {!skipFaceVerification && countdown === null && (faceStatus === "no-face" || faceStatus === "multiple") && (
              <div className="absolute inset-0 flex items-end justify-center pb-6 pointer-events-none">
                <div
                  className="backdrop-blur-sm rounded-full px-5 py-2.5 flex items-center gap-2 shadow-lg"
                  style={{ background: "var(--alert-ink)" }}
                >
                  <AlertCircle size={14} className="text-white" />
                  <span className="text-white text-[12px] font-extrabold">
                    {faceStatus === "no-face"
                      ? "Position your face in frame"
                      : "Multiple faces detected"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {devices.length > 1 && (
              <button
                onClick={flipCamera}
                className="mint-tap flex items-center gap-2 rounded-[var(--r-btn)] border px-4 min-h-[48px] text-[12.5px] font-extrabold flex-shrink-0"
                style={{
                  background: "var(--card)",
                  borderColor: "var(--border)",
                  color: "var(--text)",
                }}
              >
                <SwitchCamera size={16} style={{ color: "var(--mint)" }} />
                Flip
              </button>
            )}
            {devices.length > 2 && (
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                aria-label="Select camera"
                className="flex-1 rounded-[var(--r-btn)] border px-3 min-h-[48px] text-[12.5px] font-bold outline-none transition-colors"
                style={{
                  background: "var(--card)",
                  borderColor: "var(--border)",
                  color: "var(--text)",
                }}
              >
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      )}

      {/* Captured photo preview */}
      {capturedImage && (
        <div className="flex flex-col gap-3">
          <div
            className="flex items-center gap-2 rounded-[var(--r-card)] px-3.5 py-2.5"
            style={{ background: "var(--mint-soft)" }}
          >
            <CheckCircle2 size={15} style={{ color: "var(--mint-strong)" }} className="shrink-0" />
            <span className="text-[12.5px] font-extrabold text-[var(--mint-strong)]">
              Photo captured successfully
            </span>
          </div>
          <div
            className="relative overflow-hidden rounded-[var(--r-card-lg)]"
            style={{ border: "1px solid var(--border)" }}
          >
            <img
              src={capturedImage}
              alt="Captured"
              className="w-full object-cover"
              style={{ aspectRatio: "4/3" }}
            />
            <div
              className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center shadow-lg"
              style={{ background: "var(--mint-btn)" }}
            >
              <CheckCircle2 size={17} className="text-white" />
            </div>
          </div>
          <button
            onClick={retake}
            className="mint-tap w-full flex items-center justify-center gap-2 rounded-[var(--r-btn)] border min-h-[48px] text-[13.5px] font-extrabold"
            style={{
              background: "var(--card)",
              borderColor: "var(--border)",
              color: "var(--text)",
            }}
          >
            <RefreshCcw size={15} style={{ color: "var(--mint)" }} />
            Retake Photo
          </button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}