"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as faceapi from "face-api.js";
import { toast } from "sonner";
import { RefreshCcw, SwitchCamera, Camera as CameraIcon, CheckCircle2, AlertCircle } from "lucide-react";

interface CameraProps {
  onCaptureAction: (dataUrl: string, faceData?: any) => void;
  onRegisterAction?: (descriptors: number[][]) => void;
  mode?: "capture" | "register";
  registeredDescriptors?: number[][];
}

const COUNTDOWN_SECONDS = 3;

// Face detection status types
type FaceStatus = "idle" | "no-face" | "multiple" | "detected" | "unsupported";

export default function Camera({ 
  onCaptureAction, 
  onRegisterAction, 
  mode = "capture", 
  registeredDescriptors 
}: CameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const modelsLoadedRef = useRef(false);
  const recognitionAvailableRef = useRef(false);
  const faceMatcherRef = useRef<faceapi.FaceMatcher | null>(null);

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [permissionGiven, setPermissionGiven] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("idle");
  const [faceCount, setFaceCount] = useState(0);
  const [lastDetections, setLastDetections] = useState<any[]>([]);
  
  // For Registration Mode
  const [registrationTakes, setRegistrationTakes] = useState<number[][]>([]);
  const [registrationStep, setRegistrationStep] = useState<number>(0); // 0: Center, 1: Left, 2: Right
  const [isVerifying, setIsVerifying] = useState(false);
  const [isMatch, setIsMatch] = useState<boolean | null>(null);

  // Helper to extract 136 normalized landmark points (68 x,y pairs)
  const getNormalizedLandmarks = useCallback((det: any) => {
    if (!det.landmarks) return null;
    const box = det.detection.box;
    const points: number[] = [];
    (det.landmarks.positions as { x: number; y: number }[]).forEach(p => {
      // Normalize relative to face box to make it independent of position/scale
      points.push((p.x - box.x) / box.width);
      points.push((p.y - box.y) / box.height);
    });
    return points;
  }, []);

  // Helper to calculate Euclidean distance for normalized landmark data
  const compareLandmarks = (current: number[], registered: number[][]) => {
    if (registered.length === 0) return false;
    
    // Check if any of the registered takes matches the current face
    return registered.some(reg => {
      if (reg.length !== current.length) return false;
      let sumSq = 0;
      for (let i = 0; i < current.length; i++) {
        sumSq += Math.pow(current[i] - reg[i], 2);
      }
      const distance = Math.sqrt(sumSq);
      
      // Normalized threshold: Since we are using normalized (0-1) coordinates,
      // a distance of ~0.4-0.6 is quite accurate across 136 values (68 pts * 2)
      // for matching while allowing for some angle variance.
      // 0.5 is a balanced threshold for identity verification.
      return distance < 0.5; 
    });
  };

  // Initialize FaceMatcher if descriptors provided
  useEffect(() => {
    if (registeredDescriptors && registeredDescriptors.length > 0) {
      const isFullDescriptor = registeredDescriptors[0].length === 128;
      
      if (isFullDescriptor && recognitionAvailableRef.current) {
        try {
          const labeledDescriptors = new faceapi.LabeledFaceDescriptors(
            "user",
            registeredDescriptors.map(d => new Float32Array(d))
          );
          faceMatcherRef.current = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
        } catch (err) {
          console.error("Error initializing FaceMatcher:", err);
        }
      } else {
        // We'll use custom landmark matching for 68-element data
        faceMatcherRef.current = null;
      }
    } else {
      faceMatcherRef.current = null;
    }
  }, [registeredDescriptors]);

  // ── Face detection loop ───────────────────────────────────────────────────

  const runFaceDetection = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runFaceDetection);
      return;
    }

    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    overlay.width = video.videoWidth || video.clientWidth;
    overlay.height = video.videoHeight || video.clientHeight;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (!modelsLoadedRef.current) {
      rafRef.current = requestAnimationFrame(runFaceDetection);
      return;
    }

    try {
      // For verification/registration, we need landmarks and optionally descriptors
      let task = faceapi.detectAllFaces(
        video,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
      ).withFaceLandmarks();

      // Only add face descriptors if the model was loaded successfully
      if (recognitionAvailableRef.current) {
        (task as any) = (task as any).withFaceDescriptors();
      }

      const detections = await task;
      
      setFaceCount(detections.length);
      setLastDetections(detections);

      if (detections.length === 0) {
        setFaceStatus("no-face");
        setIsMatch(null);
      } else if (detections.length > 1) {
        setFaceStatus("multiple");
        setIsMatch(null);
        // Draw red boxes for extra faces
        detections.forEach((det: any) => {
          const { x, y, width, height } = det.detection.box;
          const scaleX = overlay.width / video.videoWidth;
          const scaleY = overlay.height / video.videoHeight;
          ctx.strokeStyle = "var(--brand-primary)";
          ctx.lineWidth = 2;
          ctx.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY);
        });
      } else {
        setFaceStatus("detected");
        const det = detections[0] as any;
        
        // Handle Verification Cross-matching
        if (mode === "capture" && registeredDescriptors && registeredDescriptors.length > 0) {
          const isFullDescriptor = registeredDescriptors[0].length === 128;
          
          if (isFullDescriptor && faceMatcherRef.current && recognitionAvailableRef.current && det.descriptor) {
            // Case 1: Real face recognition model available
            const bestMatch = faceMatcherRef.current.findBestMatch(det.descriptor);
            setIsMatch(bestMatch.label !== "unknown");
          } else {
            // Case 2: Landmark fallback matching (136 points - X and Y normalized)
            const currentLandmarks = getNormalizedLandmarks(det);
            if (currentLandmarks) {
              setIsMatch(compareLandmarks(currentLandmarks, registeredDescriptors));
            }
          }
        } else if (mode === "capture") {
          // Strict: User is registered but matching failed to initialize
          setIsMatch(false); 
        }

        // Draw a polished scan frame around the single detected face
        const { x, y, width, height } = det.detection.box;
        const scaleX = overlay.width / video.videoWidth;
        const scaleY = overlay.height / video.videoHeight;
        const fx = x * scaleX;
        const fy = y * scaleY;
        const fw = width * scaleX;
        const fh = height * scaleY;
        const padding = 20;
        const px = fx - padding;
        const py = fy - padding;
        const pw = fw + padding * 2;
        const ph = fh + padding * 2;
        const corner = 18;

        // Color logic based on match
        const statusColor = mode === "register" ? "#1A7A4A" : (isMatch === null ? "#1A7A4A" : (isMatch ? "#1A7A4A" : "var(--brand-primary)"));
        const statusBg = mode === "register" ? "rgba(26, 122, 74, 0.06)" : (isMatch === null ? "rgba(26, 122, 74, 0.06)" : (isMatch ? "rgba(26, 122, 74, 0.06)" : "rgba(var(--brand-primary-rgb, 204, 19, 24), 0.06)"));

        // Soft glow fill
        ctx.fillStyle = statusBg;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, corner);
        ctx.fill();

        // Border
        ctx.strokeStyle = statusColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, corner);
        ctx.stroke();

        // Corner accent lines
        const len = 18;
        const lw = 3;
        ctx.strokeStyle = statusColor;
        ctx.lineWidth = lw;
        ctx.lineCap = "round";

        const corners = [
          [px, py + len, px, py, px + len, py],
          [px + pw - len, py, px + pw, py, px + pw, py + len],
          [px, py + ph - len, px, py + ph, px + len, py + ph],
          [px + pw - len, py + ph, px + pw, py + ph, px + pw, py + ph - len],
        ];

        corners.forEach(([x1, y1, x2, y2, x3, y3]) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineTo(x3, y3);
          ctx.stroke();
        });

        // Scan line animation
        const now = performance.now();
        const period = 2000;
        const t = ((now % period) / period);
        const scanY = py + t * ph;
        const grad = ctx.createLinearGradient(px, scanY - 8, px, scanY + 8);
        grad.addColorStop(0, "rgba(var(--brand-primary-rgb, 204,19,24),0)");
        grad.addColorStop(0.5, isMatch === false ? "rgba(var(--brand-primary-rgb, 204,19,24),0.4)" : "rgba(26,122,74,0.4)");
        grad.addColorStop(1, "rgba(var(--brand-primary-rgb, 204,19,24),0)");
        ctx.fillStyle = grad;
        ctx.fillRect(px, scanY - 8, pw, 16);
      }
    } catch (err) {
      console.error("Detection error:", err);
      setFaceStatus("unsupported");
    }

    rafRef.current = requestAnimationFrame(runFaceDetection);
  }, [mode, isMatch]);

  // ── Initialize face-api.js models ───────────────────────────────────────────

  useEffect(() => {
    const loadModels = async () => {
      const MODEL_URL = "/models";
      try {
        // Essential: Detector and Landmarks
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(`${MODEL_URL}/tiny_face_detector`),
          faceapi.nets.faceLandmark68Net.loadFromUri(`${MODEL_URL}/face_landmark68`),
        ]);
        modelsLoadedRef.current = true;
        
        // Optional: Recognition (might fail if files missing)
        try {
          await faceapi.nets.faceRecognitionNet.loadFromUri(`${MODEL_URL}/face_recognition`);
          recognitionAvailableRef.current = true;
        } catch (e) {
          console.warn("Face Recognition model failed to load. Identity verification will be limited.", e);
        }

        // Optional: Expressions
        try {
          await faceapi.nets.faceExpressionNet.loadFromUri(`${MODEL_URL}/face_expression`);
        } catch (e) {}

      } catch (err) {
        console.error("Critical error loading base face-api models:", err);
        setFaceStatus("unsupported");
      }
    };
    loadModels();
  }, []);

  // Start / stop detection loop
  useEffect(() => {
    if (permissionGiven && cameraStarted && !capturedImage) {
      rafRef.current = requestAnimationFrame(runFaceDetection);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [permissionGiven, cameraStarted, capturedImage, runFaceDetection]);

  // ── Camera control ─────────────────────────────────────────────────────────

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
      // Fallback without exact deviceId
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (videoRef.current) videoRef.current.srcObject = stream;
        streamRef.current = stream;
      } catch (e) {
        console.error("Camera error:", e);
      }
    }
  };

  const requestPermission = async () => {
    try {
      // First, try to get the stream to trigger permission prompt
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "user" } 
      });
      
      setPermissionGiven(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
      streamRef.current = stream;

      // After permission is granted, enumerate devices to get labels
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = all.filter((d) => d.kind === "videoinput");
      
      setDevices(videoDevices);
      if (videoDevices.length > 0) {
        // Prefer a device that was already selected if it exists
        const exists = videoDevices.find(d => d.deviceId === selectedDevice);
        if (!exists) setSelectedDevice(videoDevices[0].deviceId);
      }
      setCameraStarted(true);
    } catch (e: any) {
      console.error("Camera access error:", e);
      if (e.name === "NotAllowedError") {
        alert("Camera access denied. Please enable it in your browser settings.");
      } else if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
        alert("No camera found on this device.");
      } else {
        alert("Could not start camera. Please refresh and try again.");
      }
    }
  };

  // Auto-check for existing permissions on mount
  useEffect(() => {
    const checkPermission = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasLabels = devices.some(d => d.kind === "videoinput" && d.label !== "");
        if (hasLabels) {
          // Permission might already be given, try to start
          requestPermission();
        }
      } catch (e) {
        console.warn("Permission check failed", e);
      }
    };
    checkPermission();
  }, []);

  useEffect(() => {
    if (!permissionGiven || !cameraStarted || !selectedDevice) return;
    startCamera(selectedDevice);
  }, [selectedDevice, permissionGiven, cameraStarted]);

  const flipCamera = () => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === selectedDevice);
    const next = (idx + 1) % devices.length;
    setSelectedDevice(devices[next].deviceId);
  };

  // ── Capture flow ───────────────────────────────────────────────────────────

  const handleTap = () => {
    // Check if user is registered in capture mode
    const isRegistered = registeredDescriptors && registeredDescriptors.length > 0;
    
    if (mode === "capture" && !isRegistered) {
      toast.error("Biometrics not registered! Please register your face first.");
      return;
    }

    // Capture blocked if face doesn't match in capture mode
    if (mode === "capture" && faceMatcherRef.current && isMatch === false) {
      toast.error("Identity mismatch! Please ensure you are the registered user.");
      return;
    }

    // Only allow tap if face is detected OR if face detection is unsupported (fallback)
    const canCapture = faceStatus === "detected" || faceStatus === "unsupported";
    if (!capturedImage && countdown === null) {
      if (canCapture) {
        if (mode === "register") {
          registerTake();
        } else {
          setCountdown(COUNTDOWN_SECONDS);
        }
      } else {
        console.log("Capture blocked: face not detected");
      }
    }
  };

  const registerTake = () => {
    if (lastDetections.length === 0 || registrationTakes.length >= 3) return;
    
    const det = lastDetections[0] as any;
    
    // Always use normalized landmarks for robust cross-angle matching
    const normalizedPoints = getNormalizedLandmarks(det);
    if (!normalizedPoints) {
      toast.error("Landmarks not found. Try again.");
      return;
    }

    const newTakes = [...registrationTakes, normalizedPoints];
    setRegistrationTakes(newTakes);
    
    if (newTakes.length < 3) {
      setRegistrationStep(newTakes.length);
      const angleHints = ["Tingin sa gitna (Center)", "Tingin sa kaliwa (Left)", "Tingin sa kanan (Right)"];
      toast.success(`Take ${newTakes.length}/3 captured! Ngayon, ${angleHints[newTakes.length]}.`);
    } else {
      toast.success("Face registration complete!");
      onRegisterAction?.(newTakes);
    }
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { capture(); return; }
    const t = setTimeout(() => setCountdown((p) => (p! > 0 ? p! - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const capture = () => {
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

    // Prepare face data coordinates if detected
    let faceData = null;
    if (lastDetections.length > 0) {
      const det = lastDetections[0];
      // Note: detection structure changed because we added withFaceLandmarks()
      const box = det.detection ? det.detection.box : det.box;
      const score = det.detection ? det.detection.score : det.score;
      
      faceData = {
        box: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        },
        score: score,
      };
    }

    onCaptureAction(dataUrl, faceData);
    setCountdown(null);

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const retake = () => {
    setCapturedImage(null);
    setCountdown(null);
    setFaceStatus("idle");
    setRegistrationStep(0);
    setRegistrationTakes([]);
    if (selectedDevice) startCamera(selectedDevice);
    setTimeout(() => {
      rafRef.current = requestAnimationFrame(runFaceDetection);
    }, 500);
  };

  // ── Status helpers ─────────────────────────────────────────────────────────

  const registrationGuidance = [
    { label: "Harap sa gitna (Center)", icon: "👤" },
    { label: "Lumingon sa kaliwa (Left)", icon: "⬅️" },
    { label: "Lumingon sa kanan (Right)", icon: "➡️" },
  ];

  const statusConfig: Record<FaceStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    idle: { label: "Starting camera…", color: "#6B7280", bg: "bg-gray-100", icon: null },
    unsupported: { label: "Tap to capture", color: "#6B7280", bg: "bg-gray-100", icon: null },
    "no-face": { label: "No face detected", color: "var(--brand-primary)", bg: "bg-brand-light", icon: <AlertCircle size={13} /> },
    multiple: { label: "Multiple faces detected", color: "#A0611A", bg: "bg-[#FDF4E7]", icon: <AlertCircle size={13} /> },
    detected: { 
      label: mode === "register" 
        ? `${registrationGuidance[registrationStep].icon} Step ${registrationStep + 1}/3: ${registrationGuidance[registrationStep].label}` 
        : (registeredDescriptors && registeredDescriptors.length > 0
            ? (isMatch === null 
                ? "Face detected — verifying identity…" 
                : (isMatch ? "Identity verified — tap to capture" : "Identity mismatch!"))
            : "User not registered — capture blocked"), 
      color: (mode === "register" || isMatch === true) ? "#1A7A4A" : "var(--brand-primary)", 
      bg: (mode === "register" || isMatch === true) ? "bg-[#EEF7F2]" : "bg-brand-light", 
      icon: (mode === "register" || isMatch === true) ? <CheckCircle2 size={13} /> : <AlertCircle size={13} /> 
    },
  };

  const sc = statusConfig[faceStatus];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full flex flex-col gap-3">

      {/* ── Permission prompt ── */}
      {!permissionGiven && (
        <button
          onClick={requestPermission}
          className="w-full rounded-2xl border-2 border-dashed border-gray-200 bg-brand-bg py-8 flex flex-col items-center gap-3 hover:border-brand-primary/40 hover:bg-brand-light transition-all group"
        >
          <div className="w-14 h-14 rounded-2xl bg-brand-light flex items-center justify-center group-hover:bg-brand-primary transition-colors">
            <CameraIcon size={24} className="text-brand-primary group-hover:text-white transition-colors" />
          </div>
          <div className="text-center">
            <p className="text-[13px] font-semibold text-gray-700">Start Camera</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Tap to allow camera access</p>
          </div>
        </button>
      )}

      {/* ── Live camera ── */}
      {permissionGiven && !capturedImage && (
        <>
          {/* Face status badge */}
          {faceStatus !== "idle" && (
            <div className={`flex items-center gap-2 rounded-2xl px-3 py-2 ${sc.bg}`}>
              {sc.icon && <span style={{ color: sc.color }}>{sc.icon}</span>}
              <span className="text-[12px] font-semibold" style={{ color: sc.color }}>{sc.label}</span>
              {faceStatus === "detected" && (
                <span className="ml-auto w-2 h-2 rounded-full bg-[#1A7A4A] animate-pulse" />
              )}
            </div>
          )}

          {/* Camera viewfinder */}
          <div
            className={`relative w-full select-none overflow-hidden rounded-2xl border border-gray-200 bg-black transition-all ${
              faceStatus === "detected" || faceStatus === "unsupported" 
                ? "cursor-pointer active:scale-[0.995]" 
                : "cursor-not-allowed grayscale-[0.2]"
            }`}
            onClick={handleTap}
            onTouchStart={handleTap}
            style={{ aspectRatio: "4/3" }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Face detection overlay canvas */}
            <canvas
              ref={overlayRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />

            {/* Countdown overlay */}
            {countdown !== null && countdown > 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="flex flex-col items-center gap-2">
                  <span
                    className="text-white font-bold leading-none"
                    style={{
                      fontSize: 72,
                      textShadow: "0 0 32px var(--brand-primary)",
                    }}
                  >
                    {countdown}
                  </span>
                  <span className="text-white/70 text-[13px] font-medium tracking-wide">Capturing…</span>
                </div>
              </div>
            )}

            {/* Idle tap hint (no countdown, no face detected or unsupported) */}
            {countdown === null && (faceStatus === "unsupported" || faceStatus === "idle") && (
              <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
                <div className="bg-black/50 rounded-full px-4 py-2">
                  <span className="text-white text-[12px] font-medium">Tap to capture</span>
                </div>
              </div>
            )}

            {/* Ready to capture hint when face detected */}
            {countdown === null && faceStatus === "detected" && (
              <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
                <div className={`${(isMatch === false || !(registeredDescriptors && registeredDescriptors.length > 0)) && mode === "capture" ? "bg-brand-primary/80" : "bg-[#1A7A4A]/80"} rounded-full px-4 py-2 flex items-center gap-2 shadow-lg`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  <span className="text-white text-[12px] font-medium">
                    {mode === "register" 
                      ? `Tap to take photo ${registrationStep + 1}/3: ${registrationGuidance[registrationStep].label}` 
                      : (!(registeredDescriptors && registeredDescriptors.length > 0)
                          ? "User not registered"
                          : (isMatch === false ? "Identity mismatch!" : "Tap to capture"))}
                  </span>
                </div>
              </div>
            )}

            {/* No face / multiple hint */}
            {countdown === null && (faceStatus === "no-face" || faceStatus === "multiple") && (
              <div className="absolute inset-0 flex items-end justify-center pb-6 pointer-events-none">
                <div className="bg-brand-primary/90 backdrop-blur-sm rounded-full px-5 py-2.5 flex items-center gap-2 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <AlertCircle size={14} className="text-white" />
                  <span className="text-white text-[12px] font-semibold">
                    {faceStatus === "no-face" ? "Position your face in frame" : "Multiple faces detected"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div className="flex gap-2">
            {/* Camera selector */}
            {devices.length > 1 && (
              <button
                onClick={flipCamera}
                className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-[12px] font-semibold text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-all active:scale-95 flex-shrink-0"
              >
                <SwitchCamera size={15} />
                Flip
              </button>
            )}

            {/* Device dropdown (only on desktop where multiple cameras exist) */}
            {devices.length > 2 && (
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                className="flex-1 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-[12px] text-gray-700 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
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

      {/* ── Captured photo preview ── */}
      {capturedImage && (
        <div className="flex flex-col gap-3">
          {/* Success banner */}
          <div className="flex items-center gap-2 bg-[#EEF7F2] rounded-2xl px-3 py-2.5">
            <CheckCircle2 size={15} className="text-[#1A7A4A] flex-shrink-0" />
            <span className="text-[12px] font-semibold text-[#1A7A4A]">Photo captured successfully</span>
          </div>

          {/* Preview */}
          <div className="relative overflow-hidden rounded-2xl border border-gray-200">
            <img
              src={capturedImage}
              alt="Captured photo"
              className="w-full object-cover"
              style={{ aspectRatio: "4/3" }}
            />
            {/* Overlay check mark */}
            <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-[#1A7A4A] flex items-center justify-center shadow-lg">
              <CheckCircle2 size={16} className="text-white" />
            </div>
          </div>

          {/* Retake button */}
          <button
            onClick={retake}
            className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-2xl py-3 text-[13px] font-semibold text-gray-600 hover:border-brand-primary/40 hover:bg-brand-light hover:text-brand-primary transition-all active:scale-[0.98]"
          >
            <RefreshCcw size={14} />
            Retake Photo
          </button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}