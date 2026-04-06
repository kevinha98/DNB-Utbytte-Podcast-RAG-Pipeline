"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getEpisode } from "@/lib/api";
import type { EpisodeSummary, EpisodeDetail } from "@/types";
import { useIsDark } from "@/hooks/useTheme";

interface EpisodeCardProps {
  episode: EpisodeSummary;
}

export function EpisodeCard({ episode }: EpisodeCardProps) {
  const isDark = useIsDark();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<EpisodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleExpand = async () => {
    if (expanded) { setExpanded(false); return; }
    if (!detail) {
      setLoading(true);
      try {
        const data = await getEpisode(episode.episode_number);
        setDetail(data);
      } catch { /* silently fail */ }
      finally { setLoading(false); }
    }
    setExpanded(true);
  };

  return (
    <motion.div
      ref={cardRef}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", damping: 20, stiffness: 300 }}
      className="rounded-xl overflow-hidden"
      style={{
        background: hovered
          ? isDark ? "rgba(0,114,114,0.07)" : "rgba(0,52,62,0.04)"
          : isDark ? "rgba(8, 22, 28, 0.55)" : "rgba(255,255,255,0.80)",
        border: hovered
          ? isDark ? "1px solid rgba(0,114,114,0.35)" : "1px solid rgba(0,52,62,0.30)"
          : isDark ? "1px solid rgba(0,114,114,0.12)" : "1px solid rgba(0,52,62,0.10)",
        boxShadow: hovered
          ? isDark ? "0 4px 20px rgba(0,0,0,0.3), 0 0 16px rgba(0,114,114,0.12)" : "0 4px 16px rgba(0,52,62,0.10)"
          : isDark ? "0 1px 4px rgba(0,0,0,0.25)" : "0 1px 3px rgba(0,52,62,0.06)",
        transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s",
      }}
    >
      <button
        onClick={handleExpand}
        className="w-full text-left p-sm"
      >
        <div className="flex items-start justify-between gap-xs">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-xs mb-1">
              {/* Episode number badge with glow */}
              <span
                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold shrink-0"
                style={{
                  background: "linear-gradient(135deg, #007272, #14555A)",
                  color: "rgba(255,255,255,0.92)",
                  boxShadow: hovered ? "0 0 10px rgba(0,114,114,0.5)" : "0 0 4px rgba(0,114,114,0.2)",
                  transition: "box-shadow 0.2s",
                }}
              >
                {episode.episode_number}
              </span>
              <h3
                className="text-sm font-medium truncate"
                style={{ color: hovered ? (isDark ? "rgba(255,255,255,0.92)" : "#00343E") : "var(--text-primary)" }}
              >
                {episode.title}
              </h3>
            </div>
            <div className="flex items-center gap-xs text-xs" style={{ color: "var(--text-secondary)" }}>
              <span>{episode.date}</span>
              {episode.duration && (
                <>
                  <span style={{ color: "rgba(0,114,114,0.5)" }}>·</span>
                  <span>{episode.duration}</span>
                </>
              )}
            </div>
          </div>
          <motion.svg
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="w-4 h-4 shrink-0 mt-1"
            style={{ color: "rgba(0,114,114,0.6)" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </motion.svg>
        </div>

        {/* Keywords */}
        {episode.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-xs">
            {episode.keywords.slice(0, 5).map((kw) => (
              <span
                key={kw}
                className="inline-block px-2xs py-0.5 rounded-full text-2xs font-medium"
                style={{
                  background: "rgba(0,114,114,0.08)",
                  border: isDark ? "1px solid rgba(0,114,114,0.18)" : "1px solid rgba(0,52,62,0.14)",
                  color: isDark ? "rgba(77,184,184,0.7)" : "#00343E",
                }}
              >
                {kw}
              </span>
            ))}
          </div>
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
            style={{ borderTop: "1px solid rgba(0,114,114,0.12)" }}
          >
            <div className="p-sm max-h-80 overflow-y-auto">
              {loading ? (
                <div className="space-y-xs">
                  <div className="skeleton h-4 w-full" />
                  <div className="skeleton h-4 w-3/4" />
                  <div className="skeleton h-4 w-5/6" />
                </div>
              ) : detail?.transcript ? (
                <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {detail.transcript}
                </pre>
              ) : (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {episode.description || "Ingen transkripsjon tilgjengelig."}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
