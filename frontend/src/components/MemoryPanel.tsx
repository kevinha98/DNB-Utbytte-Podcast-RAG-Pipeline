"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  getUserInstructions,
  saveUserInstructions,
  getUserFeedback,
  deleteFeedback,
  getGlobalMemory,
  type UserInstructions,
  type FeedbackEntry,
  type GlobalPattern,
} from "@/lib/api";
import { useIsDark } from "@/hooks/useTheme";

// ─── Preset options ──────────────────────────────────────────────────────────

const TONE_OPTIONS = [
  { value: "kortfattet", label: "Kortfattet" },
  { value: "detaljert", label: "Detaljert" },
  { value: "akademisk", label: "Akademisk" },
];

const LANGUAGE_OPTIONS = [
  { value: "norsk", label: "Norsk" },
  { value: "engelsk", label: "Engelsk" },
  { value: "begge", label: "Begge" },
];

const FOCUS_OPTIONS = [
  { value: "alle", label: "Alle temaer" },
  { value: "makro", label: "Makro" },
  { value: "renter", label: "Renter/inflasjon" },
  { value: "aksjer", label: "Aksjer" },
  { value: "esg", label: "ESG" },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface MemoryPanelProps {
  userId: string;
}

export function MemoryPanel({ userId }: MemoryPanelProps) {
  const isDark = useIsDark();

  // Instructions state
  const [tone, setTone] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  // Feedback history
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);

  // Global memory
  const [globalPatterns, setGlobalPatterns] = useState<GlobalPattern[]>([]);

  // Active tab
  const [tab, setTab] = useState<"instructions" | "history" | "system">("instructions");

  // Load on mount (skip if no userId yet)
  useEffect(() => {
    if (!userId) return;
    getUserInstructions(userId).then((ins) => {
      setTone(ins.preset_tone);
      setLanguage(ins.preset_language);
      setFocus(ins.preset_focus);
      setFreeText(ins.free_text ?? "");
    }).catch(() => {});
    getUserFeedback(userId).then(setFeedback).catch(() => {});
    getGlobalMemory().then(setGlobalPatterns).catch(() => {});
  }, [userId]);

  const handleSave = useCallback(async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await saveUserInstructions(userId, {
        preset_tone: tone,
        preset_language: language,
        preset_focus: focus,
        free_text: freeText || null,
      });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } finally {
      setSaving(false);
    }
  }, [userId, tone, language, focus, freeText]);

  const handleDeleteFeedback = useCallback(async (id: string) => {
    if (!userId) return;
    await deleteFeedback(userId, id).catch(() => {});
    setFeedback((prev) => prev.filter((f) => f.id !== id));
  }, [userId]);

  const chipStyle = (active: boolean) => ({
    padding: "4px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s",
    background: active
      ? isDark ? "rgba(0,114,114,0.35)" : "rgba(0,114,114,0.15)"
      : isDark ? "rgba(255,255,255,0.05)" : "rgba(0,52,62,0.05)",
    border: active
      ? "1px solid rgba(0,114,114,0.6)"
      : isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,52,62,0.12)",
    color: active
      ? isDark ? "rgba(77,184,184,1)" : "#007272"
      : isDark ? "rgba(255,255,255,0.6)" : "#54585A",
  });

  const tabStyle = (active: boolean) => ({
    padding: "6px 14px",
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s",
    background: active
      ? isDark ? "rgba(0,114,114,0.25)" : "rgba(0,114,114,0.1)"
      : "transparent",
    color: active
      ? isDark ? "rgba(77,184,184,1)" : "#007272"
      : isDark ? "rgba(255,255,255,0.5)" : "#8C8F91",
    border: "none",
  });

  return (
    <div className="px-lg py-sm space-y-sm">
      {/* Tab row */}
      <div className="flex gap-1">
        <button style={tabStyle(tab === "instructions")} onClick={() => setTab("instructions")}>
          Instruksjoner
        </button>
        <button style={tabStyle(tab === "history")} onClick={() => setTab("history")}>
          Historikk ({feedback.filter(f => f.thumbs === 0).length})
        </button>
        <button style={tabStyle(tab === "system")} onClick={() => setTab("system")}>
          Systemlæring
        </button>
      </div>

      <AnimatePresence mode="wait">
        {/* ── Instructions tab ── */}
        {tab === "instructions" && (
          <motion.div
            key="instructions"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="space-y-sm"
          >
            {/* Tone */}
            <div>
              <p className="text-xs font-medium mb-xs" style={{ color: "var(--text-secondary)" }}>Tone</p>
              <div className="flex flex-wrap gap-xs">
                {TONE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    style={chipStyle(tone === opt.value)}
                    onClick={() => setTone(tone === opt.value ? null : opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Language */}
            <div>
              <p className="text-xs font-medium mb-xs" style={{ color: "var(--text-secondary)" }}>Språk</p>
              <div className="flex flex-wrap gap-xs">
                {LANGUAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    style={chipStyle(language === opt.value)}
                    onClick={() => setLanguage(language === opt.value ? null : opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Focus */}
            <div>
              <p className="text-xs font-medium mb-xs" style={{ color: "var(--text-secondary)" }}>Fokus</p>
              <div className="flex flex-wrap gap-xs">
                {FOCUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    style={chipStyle(focus === opt.value)}
                    onClick={() => setFocus(focus === opt.value ? null : opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Free text */}
            <div>
              <p className="text-xs font-medium mb-xs" style={{ color: "var(--text-secondary)" }}>
                Egne instruksjoner
              </p>
              <div className="relative">
                <textarea
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value.slice(0, 500))}
                  placeholder="F.eks. «Svar alltid med et konkret tall eller dato», «Nevn alltid hvilken episode»..."
                  rows={3}
                  className="w-full rounded-xl text-sm resize-none outline-none px-sm py-xs"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,52,62,0.04)",
                    border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,52,62,0.12)",
                    color: "var(--text-primary)",
                  }}
                />
                <span className="absolute bottom-2 right-3 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                  {freeText.length}/500
                </span>
              </div>
            </div>

            {/* Save button */}
            <div className="flex items-center gap-sm">
              <button
                onClick={handleSave}
                disabled={saving || !userId}
                className="text-sm font-medium px-md py-xs rounded-xl transition-all"
                style={{
                  background: "linear-gradient(135deg, #007272 0%, #14555A 100%)",
                  color: "white",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Lagrer..." : "Lagre"}
              </button>
              {saveOk && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs"
                  style={{ color: "var(--color-success)" }}
                >
                  ✓ Lagret
                </motion.span>
              )}
            </div>
          </motion.div>
        )}

        {/* ── History tab ── */}
        {tab === "history" && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="space-y-xs"
          >
            {feedback.length === 0 ? (
              <p className="text-xs italic" style={{ color: "var(--text-secondary)" }}>
                Du har ikke gitt noen tilbakemeldinger ennå.
              </p>
            ) : (
              feedback.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl p-sm flex gap-sm items-start"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,52,62,0.04)",
                    border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,52,62,0.08)",
                  }}
                >
                  <span style={{ fontSize: 16 }}>{entry.thumbs === 1 ? "👍" : "👎"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                      {entry.question}
                    </p>
                    {entry.correction && (
                      <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                        Korreksjon: {entry.correction}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteFeedback(entry.id)}
                    className="text-xs shrink-0 hover:opacity-70 transition-opacity"
                    style={{ color: "var(--text-secondary)" }}
                    title="Slett"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </motion.div>
        )}

        {/* ── System learning tab ── */}
        {tab === "system" && (
          <motion.div
            key="system"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="space-y-xs"
          >
            {globalPatterns.length === 0 ? (
              <p className="text-xs italic" style={{ color: "var(--text-secondary)" }}>
                Ingen globale mønstre oppdaget ennå — systemet lærer etter hvert som brukere gir tilbakemeldinger.
              </p>
            ) : (
              globalPatterns.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl p-sm"
                  style={{
                    background: isDark ? "rgba(0,114,114,0.08)" : "rgba(0,114,114,0.05)",
                    border: "1px solid rgba(0,114,114,0.18)",
                  }}
                >
                  <p className="text-xs" style={{ color: "var(--text-primary)" }}>{p.pattern}</p>
                  <p className="text-[10px] mt-1" style={{ color: "rgba(0,114,114,0.65)" }}>
                    {p.score} tilbakemelding{p.score !== 1 ? "er" : ""}
                  </p>
                </div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
