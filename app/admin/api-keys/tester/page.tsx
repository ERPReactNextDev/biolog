"use client";

/* ============================================================================
   API TESTER — Advanced Animated Edition
   ============================================================================ */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Check, Clock, Copy, Loader2,
  Play, Zap, Shield, Database, Globe, ArrowRight,
  CheckCircle2, XCircle, Wifi, Lock,
} from "lucide-react";
import { toast } from "sonner";

/* ─── types ────────────────────────────────────────────────────────────── */
type Method = "GET" | "POST";
type Phase = "idle" | "key-check" | "sending" | "receiving" | "done" | "error";

type Endpoint = {
  method: Method;
  path: string;
  scope: string;
  description: string;
  defaultParams: Record<string, string>;
  defaultBody?: string;
};

const ENDPOINTS: Endpoint[] = [
  {
    method: "GET", path: "/api/v1/tasklog", scope: "read:tasklog",
    description: "List tasklog entries",
    defaultParams: { limit: "5", offset: "0" },
  },
  {
    method: "GET", path: "/api/v1/tasklog", scope: "read:tasklog",
    description: "Filter by agent & date range",
    defaultParams: {
      ReferenceID: "",
      date_from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      date_to: new Date().toISOString().slice(0, 10),
      limit: "10",
    },
  },
  {
    method: "POST", path: "/api/v1/tasklog", scope: "write:tasklog",
    description: "Create a new tasklog entry",
    defaultParams: {},
    defaultBody: JSON.stringify({
      ReferenceID: "TEST-001", Email: "test@example.com",
      Type: "On Field", Status: "Login",
      Remarks: "API test entry", Location: "Quezon City, Metro Manila",
      Latitude: "14.6760", Longitude: "121.0437",
    }, null, 2),
  },
];

/* ─── helpers ──────────────────────────────────────────────────────────── */
function buildUrl(path: string, params: Record<string, string>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v.trim() !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return q ? `${path}?${q}` : path;
}

function syntaxHighlight(json: string): string {
  return json
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (m) => {
        if (/^"/.test(m)) return /:$/.test(m)
          ? `<span style="color:var(--info);font-weight:700">${m}</span>`
          : `<span style="color:var(--mint-strong)">${m}</span>`;
        if (/true|false/.test(m)) return `<span style="color:var(--violet-ink)">${m}</span>`;
        if (/null/.test(m)) return `<span style="color:var(--text-muted)">${m}</span>`;
        return `<span style="color:var(--hint-text)">${m}</span>`;
      }
    );
}

/* ─── Animated packet dot ───────────────────────────────────────────────── */
function PacketDot({ active, direction }: { active: boolean; direction: "right" | "left" }) {
  return (
    <div className="relative h-1 flex-1 mx-1 overflow-hidden">
      <div className="absolute inset-y-0 left-0 right-0 flex items-center">
        <div className="h-px w-full" style={{ background: "var(--mint-soft)" }} />
      </div>
      {active && (
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
          style={{
            background: "var(--mint-strong)",
            boxShadow: "0 0 8px var(--mint-strong), 0 0 16px var(--mint-strong)",
            animation: `${direction === "right" ? "slideRight" : "slideLeft"} 0.6s ease-in-out infinite`,
          }}
        />
      )}
      <style>{`
        @keyframes slideRight { from { left: 0%; } to { left: 100%; } }
        @keyframes slideLeft  { from { left: 100%; } to { left: 0%; } }
      `}</style>
    </div>
  );
}

/* ─── Flow node ─────────────────────────────────────────────────────────── */
function FlowNode({
  icon, label, active, success, error: hasError,
}: {
  icon: React.ReactNode; label: string;
  active?: boolean; success?: boolean; error?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300"
        style={{
          background: success
            ? "var(--mint-soft)"
            : hasError
              ? "var(--alert-soft)"
              : active
                ? "var(--mint-btn)"
                : "var(--card)",
          border: `2px solid ${success ? "var(--mint-strong)" : hasError ? "var(--alert)" : active ? "var(--mint)" : "var(--card-alt)"}`,
          boxShadow: active || success ? `0 0 12px ${success ? "var(--mint-strong)" : "var(--mint)"}40` : "none",
          transform: active ? "scale(1.1)" : "scale(1)",
        }}
      >
        <span style={{ color: success ? "var(--mint-strong)" : hasError ? "var(--alert)" : active ? "var(--mint)" : "var(--text-muted)" }}>
          {icon}
        </span>
      </div>
      <span className="text-[9.5px] font-extrabold uppercase tracking-[0.1em]"
        style={{ color: success ? "var(--mint-strong)" : hasError ? "var(--alert)" : active ? "var(--mint)" : "var(--text-muted)" }}>
        {label}
      </span>
    </div>
  );
}

/* ─── Typewriter text ───────────────────────────────────────────────────── */
function TypewriterText({ text, speed = 1 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const ref = useRef(0);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    ref.current = 0;
    if (!text) return;

    // Batch characters for speed
    const batchSize = Math.max(1, Math.floor(text.length / 80));
    const interval = setInterval(() => {
      ref.current += batchSize;
      if (ref.current >= text.length) {
        setDisplayed(text);
        setDone(true);
        clearInterval(interval);
      } else {
        setDisplayed(text.slice(0, ref.current));
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return { displayed, done };
}

/* ─── Live ms counter ───────────────────────────────────────────────────── */
function useLiveMs(running: boolean) {
  const [ms, setMs] = useState(0);
  const start = useRef(0);

  useEffect(() => {
    if (running) {
      start.current = Date.now();
      setMs(0);
      const id = setInterval(() => setMs(Date.now() - start.current), 16);
      return () => clearInterval(id);
    }
  }, [running]);

  return ms;
}

/* ─── Particle burst ────────────────────────────────────────────────────── */
function ParticleBurst({ trigger, color }: { trigger: boolean; color: string }) {
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; a: number }[]>([]);

  useEffect(() => {
    if (!trigger) return;
    const p = Array.from({ length: 12 }, (_, i) => ({
      id: Date.now() + i,
      x: Math.random() * 60 - 30,
      y: Math.random() * 60 - 30,
      a: Math.random(),
    }));
    setParticles(p);
    const t = setTimeout(() => setParticles([]), 700);
    return () => clearTimeout(t);
  }, [trigger]);

  if (!particles.length) return null;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute w-1.5 h-1.5 rounded-full"
          style={{
            left: "50%", top: "50%",
            background: color,
            boxShadow: `0 0 6px ${color}`,
            animation: `burst-${p.id} 0.6s ease-out forwards`,
          }}
        />
      ))}
      <style>{particles.map((p) => `
        @keyframes burst-${p.id} {
          0%   { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(calc(-50% + ${p.x}px), calc(-50% + ${p.y}px)) scale(0); opacity: 0; }
        }
      `).join("")}</style>
    </div>
  );
}

/* ─── Matrix rain (idle background) ────────────────────────────────────── */
function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight;
    const cols = Math.floor(W / 14);
    const drops = Array(cols).fill(1);
    const chars = "01アイウエオカキクケコ{}[]<>|&%$#";

    const draw = () => {
      ctx.fillStyle = "rgba(15,23,42,.05)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "color-mix(in srgb, var(--mint) 15%, transparent)";
      ctx.font = "11px monospace";
      drops.forEach((y, i) => {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(char, i * 14, y * 14);
        if (y * 14 > H && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      });
    };

    const id = setInterval(draw, 50);
    return () => clearInterval(id);
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-60" />;
}

/* ─── Main page ─────────────────────────────────────────────────────────── */
export default function ApiTesterPage() {
  const [apiKey, setApiKey] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [params, setParams] = useState<Record<string, string>>(ENDPOINTS[0].defaultParams);
  const [body, setBody] = useState(ENDPOINTS[0].defaultBody ?? "");
  const [customPath, setCustomPath] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<{ status: number; ms: number; body: string; ok: boolean } | null>(null);
  const [burstOk, setBurstOk] = useState(false);
  const [burstErr, setBurstErr] = useState(false);

  const liveMs = useLiveMs(phase === "sending" || phase === "receiving" || phase === "key-check");

  const ep = ENDPOINTS[selectedIdx];
  const effectivePath = customPath.trim() || ep.path;

  // Typewriter for response
  const responseText = result?.body ?? "";
  const { displayed: typewriterBody, done: typewriterDone } = TypewriterText({ text: responseText, speed: 2 });

  const selectEndpoint = (idx: number) => {
    setSelectedIdx(idx);
    setParams(ENDPOINTS[idx].defaultParams);
    setBody(ENDPOINTS[idx].defaultBody ?? "");
    setResult(null);
    setPhase("idle");
    setCustomPath("");
  };

  const setParam = (k: string, v: string) =>
    setParams((prev) => ({ ...prev, [k]: v }));

  const send = useCallback(async () => {
    if (!apiKey.trim()) { toast.error("Paste your API key first."); return; }
    setResult(null);
    setBurstOk(false);
    setBurstErr(false);

    // Phase: key check
    setPhase("key-check");
    await new Promise((r) => setTimeout(r, 400));

    // Phase: sending
    setPhase("sending");
    const url = ep.method === "GET" ? buildUrl(effectivePath, params) : effectivePath;
    const start = Date.now();

    try {
      let parsedBody: unknown = undefined;
      if (ep.method === "POST" && body.trim()) {
        try { parsedBody = JSON.parse(body); }
        catch { toast.error("Request body is not valid JSON."); setPhase("idle"); return; }
      }

      const res = await fetch(url, {
        method: ep.method,
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          ...(ep.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(parsedBody !== undefined ? { body: JSON.stringify(parsedBody) } : {}),
      });

      setPhase("receiving");
      await new Promise((r) => setTimeout(r, 200));

      const ms = Date.now() - start;
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /**/ }

      setResult({ status: res.status, ms, body: pretty, ok: res.ok });
      setPhase("done");
      if (res.ok) { setTimeout(() => setBurstOk(true), 50); setTimeout(() => setBurstOk(false), 100); }
      else { setTimeout(() => setBurstErr(true), 50); setTimeout(() => setBurstErr(false), 100); }
    } catch (err: any) {
      setResult({ status: 0, ms: Date.now() - start, body: err?.message ?? "Network error", ok: false });
      setPhase("error");
      setTimeout(() => setBurstErr(true), 50); setTimeout(() => setBurstErr(false), 100);
    }
  }, [apiKey, ep, effectivePath, params, body]);

  const isRunning = phase === "key-check" || phase === "sending" || phase === "receiving";
  const nodeSuccess = phase === "done" && result?.ok;
  const nodeError   = phase === "error" || (phase === "done" && !result?.ok);

  const copyResult = async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.body); toast.success("Copied."); }
    catch { toast.error("Could not copy."); }
  };

  return (
    /* mint-ui/mint-scope gives the page the Nunito face and the Calm Mint
       palette, matching every other console screen. Previously this page had its
       own hardcoded dark palette. */
    <div className="mint-ui mint-scope" style={{ fontFamily: "inherit" }}>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="relative">
              <Zap size={18} style={{ color: "var(--mint)" }} />
              <div className="absolute inset-0 animate-ping opacity-30">
                <Zap size={18} style={{ color: "var(--mint)" }} />
              </div>
            </div>
            <h1 className="text-[22px] font-black" style={{ color: "var(--text)" }}>
              API Tester
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider"
              style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}>
              v1
            </span>
          </div>
          <p className="text-[12.5px] font-semibold" style={{ color: "var(--text-muted)" }}>
            Test your API keys against{" "}
            <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "var(--card-alt)", color: "var(--mint-strong)" }}>
              /api/v1
            </code>{" "}
            endpoints — live request visualization.
          </p>
        </div>
      </div>

      {/* ── Flow visualizer ──────────────────────────────────────────── */}
      <div
        className="rounded-[16px] p-4 mb-5 border relative overflow-hidden"
        style={{ background: "var(--card)", borderColor: "var(--card-alt)" }}
      >
        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)", backgroundSize: "24px 24px" }} />

        <div className="relative z-10 flex items-center justify-between px-4">
          <FlowNode icon={<Lock size={16} />}    label="Auth"     active={phase === "key-check"} success={["sending","receiving","done"].includes(phase) && !nodeError} error={nodeError} />
          <PacketDot active={phase === "sending"}   direction="right" />
          <FlowNode icon={<Globe size={16} />}   label="Request"  active={phase === "sending"}   success={["receiving","done"].includes(phase) && !nodeError} error={nodeError} />
          <PacketDot active={phase === "receiving"} direction="right" />
          <FlowNode icon={<Database size={16} />} label="DB"      active={phase === "receiving"} success={phase === "done" && !nodeError}   error={phase === "done" && nodeError} />
          <PacketDot active={phase === "receiving"} direction="left" />
          <FlowNode icon={<Shield size={16} />}  label="Validate" active={phase === "receiving"} success={phase === "done" && !nodeError}   error={phase === "done" && nodeError} />
          <PacketDot active={phase === "done" || phase === "error"} direction="left" />

          {/* Client node with burst */}
          <div className="flex flex-col items-center gap-1.5 relative">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 relative"
              style={{
                background: nodeSuccess ? "var(--mint-soft)" : nodeError ? "var(--alert-soft)" : "var(--card)",
                border: `2px solid ${nodeSuccess ? "var(--mint-strong)" : nodeError ? "var(--alert)" : "var(--card-alt)"}`,
                boxShadow: nodeSuccess ? "0 0 16px color-mix(in srgb, var(--mint-strong) 25%, transparent)" : nodeError ? "0 0 16px var(--alert)40" : "none",
              }}
            >
              {nodeSuccess ? <CheckCircle2 size={16} style={{ color: "var(--mint-strong)" }} />
                : nodeError ? <XCircle size={16} style={{ color: "var(--alert)" }} />
                : <Wifi size={16} style={{ color: "var(--text-muted)" }} />}
              <ParticleBurst trigger={burstOk}  color="var(--mint-strong)" />
              <ParticleBurst trigger={burstErr} color="var(--alert)" />
            </div>
            <span className="text-[9.5px] font-extrabold uppercase tracking-[0.1em]"
              style={{ color: nodeSuccess ? "var(--mint-strong)" : nodeError ? "var(--alert)" : "var(--text-muted)" }}>
              Client
            </span>
          </div>
        </div>

        {/* Status line */}
        <div className="relative z-10 flex items-center justify-center mt-3 gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: isRunning ? "var(--hint-text)" : nodeSuccess ? "var(--mint-strong)" : nodeError ? "var(--alert)" : "var(--text-muted)",
              animation: isRunning ? "pulse 1s infinite" : "none",
              boxShadow: isRunning ? "0 0 6px var(--hint-text)" : "none",
            }}
          />
          <span className="text-[11px] font-bold font-mono"
            style={{ color: isRunning ? "var(--hint-text)" : nodeSuccess ? "var(--mint-strong)" : nodeError ? "var(--alert)" : "var(--text-muted)" }}>
            {phase === "idle"      && "Ready — waiting for request"}
            {phase === "key-check" && `Validating Bearer token… ${liveMs}ms`}
            {phase === "sending"   && `Sending ${ep.method} ${effectivePath} … ${liveMs}ms`}
            {phase === "receiving" && `Receiving response … ${liveMs}ms`}
            {phase === "done"      && result && `${result.ok ? "✓ Success" : "✗ Error"} ${result.status} · ${result.ms}ms`}
            {phase === "error"     && result && `✗ Network error · ${result.ms}ms`}
          </span>
        </div>
      </div>

      {/* ── Main grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── LEFT ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">

          {/* API Key */}
          <div className="rounded-[14px] border p-4" style={{ background: "var(--card)", borderColor: "var(--card-alt)" }}>
            <p className="text-[9.5px] font-black uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-muted)" }}>
              API Key
            </p>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="blg_live_..."
                className="w-full font-mono text-[13px] px-3.5 py-2.5 rounded-[10px] border outline-none pr-10 transition-all"
                style={{
                  background: "var(--bg)",
                  borderColor: apiKey ? "var(--mint)" : "var(--card-alt)",
                  color: "var(--text)",
                  boxShadow: apiKey ? "0 0 0 2px color-mix(in srgb, var(--mint) 12%, transparent)" : "none",
                }}
              />
              {apiKey && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Check size={14} style={{ color: "var(--mint)" }} />
                </span>
              )}
            </div>
            {apiKey && (
              <p className="text-[10.5px] font-semibold mt-1.5" style={{ color: "var(--mint)" }}>
                ✓ Key loaded · {apiKey.slice(0, 16)}…
              </p>
            )}
          </div>

          {/* Endpoints */}
          <div className="rounded-[14px] border p-4" style={{ background: "var(--card)", borderColor: "var(--card-alt)" }}>
            <p className="text-[9.5px] font-black uppercase tracking-[0.16em] mb-3" style={{ color: "var(--text-muted)" }}>
              Endpoint
            </p>
            <div className="flex flex-col gap-2">
              {ENDPOINTS.map((e, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectEndpoint(i)}
                  className="flex items-start gap-2.5 px-3 py-2.5 rounded-[10px] border text-left transition-all"
                  style={{
                    borderColor: selectedIdx === i ? "var(--mint)" : "var(--card-alt)",
                    background: selectedIdx === i ? "var(--mint-soft)" : "var(--bg)",
                    boxShadow: selectedIdx === i ? "0 0 0 1px color-mix(in srgb, var(--mint) 19%, transparent)" : "none",
                  }}
                >
                  <span
                    className="shrink-0 mt-0.5 text-[10px] font-black px-2 py-0.5 rounded"
                    style={{
                      background: e.method === "GET" ? "var(--info-soft)" : "var(--hint-bg)",
                      color: e.method === "GET" ? "var(--info)" : "var(--clay-ink)",
                    }}
                  >
                    {e.method}
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] font-bold truncate" style={{ color: "var(--text)" }}>
                      {e.path}
                    </p>
                    <p className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {e.description}
                    </p>
                    <span
                      className="inline-block mt-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full"
                      style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
                    >
                      scope: {e.scope}
                    </span>
                  </div>
                  {selectedIdx === i && (
                    <ArrowRight size={14} className="shrink-0 mt-1 ml-auto" style={{ color: "var(--mint)" }} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Params / Body */}
          <div className="rounded-[14px] border p-4" style={{ background: "var(--card)", borderColor: "var(--card-alt)" }}>
            {ep.method === "GET" ? (
              <>
                <p className="text-[9.5px] font-black uppercase tracking-[0.16em] mb-3" style={{ color: "var(--text-muted)" }}>
                  Query Parameters
                </p>
                <div className="flex flex-col gap-2">
                  {Object.keys(params).map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-[120px] shrink-0 font-mono text-[11px] font-bold truncate" style={{ color: "var(--info)" }} title={k}>
                        {k}
                      </span>
                      <input
                        value={params[k]}
                        onChange={(e) => setParam(k, e.target.value)}
                        placeholder="(optional)"
                        className="flex-1 font-mono text-[12px] px-2.5 py-1.5 rounded-[8px] border outline-none transition-all"
                        style={{
                          background: "var(--bg)", borderColor: "var(--card-alt)", color: "var(--text)",
                        }}
                        onFocus={(e) => e.currentTarget.style.borderColor = "var(--mint)"}
                        onBlur={(e)  => e.currentTarget.style.borderColor = "var(--card-alt)"}
                      />
                    </div>
                  ))}
                  <div className="pt-2 border-t" style={{ borderColor: "var(--card-alt)" }}>
                    <p className="text-[9.5px] font-black uppercase tracking-[0.12em] mb-1.5" style={{ color: "var(--text-muted)" }}>
                      Custom path override
                    </p>
                    <input
                      value={customPath}
                      onChange={(e) => setCustomPath(e.target.value)}
                      placeholder={ep.path}
                      className="w-full font-mono text-[12px] px-2.5 py-1.5 rounded-[8px] border outline-none"
                      style={{ background: "var(--bg)", borderColor: "var(--card-alt)", color: "var(--text)" }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-[9.5px] font-black uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-muted)" }}>
                  Request Body (JSON)
                </p>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="w-full font-mono text-[12px] px-3 py-2.5 rounded-[10px] border outline-none resize-none"
                  style={{
                    background: "var(--bg)", borderColor: "var(--card-alt)", color: "var(--mint-strong)", lineHeight: 1.7,
                  }}
                />
              </>
            )}
          </div>

          {/* Send button */}
          <button
            type="button"
            disabled={isRunning}
            onClick={send}
            className="relative w-full min-h-[52px] rounded-[14px] font-extrabold text-[14px] flex items-center justify-center gap-2.5 overflow-hidden transition-all"
            style={{
              background: isRunning ? "var(--mint-soft)" : "var(--mint-soft)",
              color: isRunning ? "var(--mint)" : "#fff",
              border: `1px solid ${isRunning ? "var(--mint)" : "var(--mint)"}`,
              boxShadow: isRunning ? "0 0 20px color-mix(in srgb, var(--mint) 19%, transparent)" : "0 0 0 0 transparent",
            }}
          >
            {/* Animated shimmer when running */}
            {isRunning && (
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--mint) 8%, transparent) 50%, transparent 100%)",
                  animation: "shimmer 1.2s infinite",
                }}
              />
            )}
            <style>{`
              @keyframes shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
              @keyframes pulse   { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
            `}</style>
            <span className="relative z-10 flex items-center gap-2">
              {isRunning
                ? <><Loader2 size={17} className="animate-spin" /> {phase === "key-check" ? "Validating key…" : phase === "receiving" ? "Receiving…" : "Sending…"}</>
                : <><Play size={17} /> Send Request</>}
            </span>
          </button>
        </div>

        {/* ── RIGHT — Response ─────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div
            className="flex-1 rounded-[14px] border overflow-hidden flex flex-col"
            style={{ background: "var(--card)", borderColor: "var(--card-alt)", minHeight: 520 }}
          >
            {/* Response toolbar */}
            <div
              className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
              style={{ borderColor: "var(--card-alt)", background: "var(--bg)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[9.5px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                  Response
                </span>
                {result && (
                  <>
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-extrabold"
                      style={result.ok
                        ? { background: "var(--mint-soft)", color: "var(--mint-strong)" }
                        : { background: "var(--alert-soft)", color: "var(--alert)" }}
                    >
                      {result.status || "ERR"}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-mono font-semibold" style={{ color: "var(--text-muted)" }}>
                      <Clock size={11} /> {result.ms}ms
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Live ms counter while running */}
                {isRunning && (
                  <span className="font-mono text-[11px] font-bold" style={{ color: "var(--hint-text)" }}>
                    {liveMs}ms
                  </span>
                )}
                {result && (
                  <button
                    type="button"
                    onClick={copyResult}
                    className="flex items-center gap-1 text-[11px] font-extrabold px-2 py-1 rounded-[7px] transition-all hover:bg-white/5"
                    style={{ color: "var(--info)" }}
                  >
                    <Copy size={11} /> Copy
                  </button>
                )}
              </div>
            </div>

            {/* Response body */}
            <div className="flex-1 overflow-auto relative" style={{ background: "var(--card)" }}>
              {/* Idle state — matrix rain */}
              {phase === "idle" && !result && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <MatrixRain />
                  <div className="relative z-10 flex flex-col items-center gap-2 text-center px-6">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: "var(--bg)", border: "1px solid var(--card-alt)" }}>
                      <Zap size={20} style={{ color: "var(--text-muted)" }} />
                    </div>
                    <p className="text-[13px] font-bold" style={{ color: "var(--text-muted)" }}>
                      Waiting for request
                    </p>
                    <p className="text-[11px] font-semibold" style={{ color: "var(--border-strong)" }}>
                      Configure your key and endpoint, then hit Send
                    </p>
                  </div>
                </div>
              )}

              {/* Loading state */}
              {isRunning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  {/* Animated rings */}
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="absolute rounded-full border"
                        style={{
                          inset: `${i * 8}px`,
                          borderColor: `color-mix(in srgb, var(--mint) ${Math.round((0.5 - i * 0.15) * 100)}%, transparent)`,
                          animation: `spin ${0.8 + i * 0.3}s linear infinite ${i % 2 ? "reverse" : ""}`,
                        }}
                      />
                    ))}
                    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                    <Globe size={16} style={{ color: "var(--mint)" }} />
                  </div>
                  <p className="text-[12px] font-mono font-semibold" style={{ color: "var(--mint)" }}>
                    {phase === "key-check" && "Validating API key…"}
                    {phase === "sending"   && `${ep.method} ${effectivePath}`}
                    {phase === "receiving" && "Streaming response…"}
                  </p>
                  {/* Animated dots */}
                  <div className="flex gap-1.5">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: "var(--mint)",
                          animation: `bounce 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                        }}
                      />
                    ))}
                    <style>{`@keyframes bounce { from { opacity: 0.2; transform: translateY(0); } to { opacity: 1; transform: translateY(-4px); } }`}</style>
                  </div>
                </div>
              )}

              {/* Result — typewriter reveal */}
              {!isRunning && result && (
                <div className="p-4">
                  {/* Success/error flash bar */}
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-[8px] mb-3 text-[11.5px] font-extrabold"
                    style={result.ok
                      ? { background: "var(--mint-soft)", border: "1px solid color-mix(in srgb, var(--mint) 19%, transparent)", color: "var(--mint-strong)" }
                      : { background: "var(--alert-soft)", border: "1px solid var(--alert)30", color: "var(--alert)" }}
                  >
                    {result.ok
                      ? <><CheckCircle2 size={13} /> {result.status} OK · {result.ms}ms · Response received</>
                      : <><XCircle size={13} /> {result.status || "ERR"} · {result.ms}ms · {
                          result.status === 401 ? "Invalid or missing API key"
                          : result.status === 403 ? "Insufficient scope"
                          : result.status === 0   ? "Network error"
                          : "Request failed"
                        }</>
                    }
                  </div>
                  <pre
                    className="text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-words"
                    style={{ color: "var(--text)" }}
                    dangerouslySetInnerHTML={{ __html: syntaxHighlight(typewriterBody) }}
                  />
                  {!typewriterDone && (
                    <span
                      className="inline-block w-2 h-4 ml-0.5 align-middle"
                      style={{ background: "var(--mint)", animation: "pulse 0.8s infinite" }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Quick reference */}
          <div
            className="rounded-[14px] border p-4"
            style={{ background: "var(--card)", borderColor: "var(--card-alt)" }}
          >
            <p className="text-[9.5px] font-black uppercase tracking-[0.16em] mb-3" style={{ color: "var(--text-muted)" }}>
              Quick Reference
            </p>
            <div className="flex flex-col gap-2">
              {[
                { method: "GET",  path: "/api/v1/tasklog?limit=10",           scope: "read:tasklog"  },
                { method: "GET",  path: "/api/v1/tasklog?ReferenceID=SR-XXX", scope: "read:tasklog"  },
                { method: "GET",  path: "/api/v1/tasklog?Type=Client+Visit",  scope: "read:tasklog"  },
                { method: "POST", path: "/api/v1/tasklog",                    scope: "write:tasklog" },
              ].map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span
                    className="shrink-0 px-1.5 py-0.5 rounded font-extrabold text-[10px]"
                    style={r.method === "GET"
                      ? { background: "var(--info-soft)", color: "var(--info)" }
                      : { background: "var(--hint-bg)", color: "var(--hint-text)" }}
                  >
                    {r.method}
                  </span>
                  <span
                    className="flex-1 truncate font-mono"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {r.path}
                  </span>
                  <span
                    className="shrink-0 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
                  >
                    {r.scope}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
