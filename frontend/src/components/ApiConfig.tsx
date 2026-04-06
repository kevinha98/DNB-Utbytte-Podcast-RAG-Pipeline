"use client";

import { useState, useEffect, useRef } from "react";
import { getApiUrl } from "@/lib/api";

export function ApiConfig() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-open if backend is unreachable on page load
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${getApiUrl()}/api/health`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) setOpen(true);
      } catch {
        setOpen(true);
      }
    };
    check();
  }, []);

  useEffect(() => {
    setUrl(localStorage.getItem("utbytte_api_url") || "");
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const save = async () => {
    const trimmed = url.trim().replace(/\/$/, "");
    if (trimmed) {
      localStorage.setItem("utbytte_api_url", trimmed);
    } else {
      localStorage.removeItem("utbytte_api_url");
    }
    setStatus("checking");
    try {
      const res = await fetch(`${trimmed || getApiUrl()}/api/health`, { signal: AbortSignal.timeout(4000) });
      setStatus(res.ok ? "ok" : "error");
    } catch {
      setStatus("error");
    }
    setTimeout(() => { setOpen(false); setStatus("idle"); window.location.reload(); }, 1200);
  };

  return (
    <>
      {/* Gear button */}
      <button
        onClick={() => setOpen(true)}
        title="Sett backend-URL"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "4px",
          color: "rgba(77,184,184,0.6)",
          display: "flex",
          alignItems: "center",
          transition: "color 0.2s",
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "rgba(77,184,184,1)")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(77,184,184,0.6)")}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      {/* Modal */}
      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={{
            background: "var(--surface-card, #0d2028)",
            border: "1px solid rgba(0,114,114,0.35)",
            borderRadius: "14px",
            padding: "28px 28px 24px",
            width: "min(420px, 90vw)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          }}>
            <h2 style={{ margin: "0 0 6px", fontSize: "15px", fontWeight: 600, color: "var(--text-primary, #e8f0ec)" }}>
              Backend-innstillinger
            </h2>
            <p style={{ margin: "0 0 18px", fontSize: "12px", color: "rgba(150,190,175,0.7)", lineHeight: 1.5 }}>
              Oppgi URL-en til der backend kjører (f.eks. en ngrok- eller Cloudflare-tunnel-URL). La feltet stå tomt for å bruke standard <code style={{ fontSize: "11px", opacity: 0.8 }}>localhost:8000</code>.
            </p>
            <label style={{ fontSize: "11px", fontWeight: 500, color: "rgba(77,184,184,0.8)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Backend URL
            </label>
            <input
              ref={inputRef}
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setOpen(false); }}
              placeholder="https://abc123.ngrok-free.app"
              style={{
                display: "block", width: "100%", marginTop: "6px", marginBottom: "18px",
                padding: "9px 12px", borderRadius: "8px", fontSize: "13px",
                background: "rgba(0,52,62,0.5)", border: "1px solid rgba(0,114,114,0.3)",
                color: "var(--text-primary, #e8f0ec)", outline: "none", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", alignItems: "center" }}>
              {status === "checking" && <span style={{ fontSize: "12px", color: "rgba(77,184,184,0.7)" }}>Tester tilkobling…</span>}
              {status === "ok" && <span style={{ fontSize: "12px", color: "#4ade80" }}>✓ Tilkoblet!</span>}
              {status === "error" && <span style={{ fontSize: "12px", color: "#f87171" }}>✗ Feil — sjekk URL</span>}
              <button
                onClick={() => setOpen(false)}
                style={{
                  padding: "7px 14px", borderRadius: "7px", fontSize: "12px", cursor: "pointer",
                  background: "transparent", border: "1px solid rgba(0,114,114,0.3)",
                  color: "rgba(150,190,175,0.7)",
                }}
              >
                Avbryt
              </button>
              <button
                onClick={save}
                disabled={status === "checking"}
                style={{
                  padding: "7px 16px", borderRadius: "7px", fontSize: "12px", cursor: "pointer",
                  background: "rgba(0,114,114,0.75)", border: "none", color: "#fff", fontWeight: 500,
                }}
              >
                Lagre
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
