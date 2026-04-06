"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getEpisodes } from "@/lib/api";
import type { EpisodeSummary } from "@/types";
import { EpisodeCard } from "./EpisodeCard";
import { useIsDark } from "@/hooks/useTheme";

const listVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 10, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: [0.34, 1.2, 0.64, 1] as [number, number, number, number] } },
};

/** Parse "MM:SS" or "H:MM:SS" duration string to minutes. */
function durationToMinutes(d: string): number {
  if (!d) return 0;
  const parts = d.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return 0;
}

/** Extract year from date string like "2026-03-14" or "Thu, 28 Ma..." */
function extractYear(date: string): number {
  const m = date.match(/(\d{4})/);
  return m ? parseInt(m[1]) : 0;
}

/** Best-effort guest extraction from title ("... med X og Y"). */
function extractGuest(title: string): string | null {
  const m = title.match(/\bmed\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

const DURATION_OPTIONS = [
  { label: "Alle", min: 0, max: Infinity },
  { label: "< 15 min", min: 0, max: 15 },
  { label: "15–30 min", min: 15, max: 30 },
  { label: "30–60 min", min: 30, max: 60 },
  { label: "> 60 min", min: 60, max: Infinity },
];

export function EpisodeList() {
  const isDark = useIsDark();
  const [allEpisodes, setAllEpisodes] = useState<EpisodeSummary[]>([]);
  const [search, setSearch] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [yearFilter, setYearFilter] = useState<string>("");
  const [durationIdx, setDurationIdx] = useState(0);
  const [guestFilter, setGuestFilter] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await getEpisodes();
        setAllEpisodes(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kunne ikke laste episoder");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Derive unique years for the year filter dropdown
  const availableYears = useMemo(() => {
    const years = new Set(allEpisodes.map((e) => extractYear(e.date)).filter(Boolean));
    return Array.from(years).sort((a, b) => b - a);
  }, [allEpisodes]);

  // Derive unique guests/companies for the guest dropdown
  const availableGuests = useMemo(() => {
    const guests = new Map<string, number>();
    for (const e of allEpisodes) {
      const g = extractGuest(e.title);
      if (g) guests.set(g, (guests.get(g) || 0) + 1);
    }
    return Array.from(guests.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [allEpisodes]);

  // Client-side filtering
  const filtered = useMemo(() => {
    let eps = allEpisodes;

    // Text search (title + description + keywords)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      eps = eps.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.keywords.some((k) => k.toLowerCase().includes(q))
      );
    }

    // Year filter
    if (yearFilter) {
      const y = parseInt(yearFilter);
      eps = eps.filter((e) => extractYear(e.date) === y);
    }

    // Duration filter
    const dur = DURATION_OPTIONS[durationIdx];
    if (dur.min > 0 || dur.max < Infinity) {
      eps = eps.filter((e) => {
        const m = durationToMinutes(e.duration);
        return m >= dur.min && m < dur.max;
      });
    }

    // Guest filter
    if (guestFilter) {
      eps = eps.filter((e) => {
        const g = extractGuest(e.title);
        return g !== null && g.toLowerCase().includes(guestFilter.toLowerCase());
      });
    }

    // Sort
    if (sortOrder === "newest") {
      eps = [...eps].reverse();
    }

    return eps;
  }, [allEpisodes, search, yearFilter, durationIdx, guestFilter, sortOrder]);

  const hasActiveFilters = yearFilter || durationIdx > 0 || guestFilter;

  const pillStyle = (active: boolean) => ({
    background: active ? "rgba(0,114,114,0.18)" : isDark ? "rgba(255,255,255,0.04)" : "rgba(0,52,62,0.04)",
    border: `1px solid ${active ? "rgba(0,114,114,0.45)" : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,52,62,0.12)"}`,
    color: active ? (isDark ? "rgba(77,184,184,0.95)" : "#007272") : "var(--text-secondary)",
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-md" style={{ borderBottom: "1px solid rgba(0,114,114,0.15)" }}>
        <div className="flex items-center justify-between mb-xs">
          <h2 className="text-sm font-semibold gradient-text">
            Episoder{" "}
            {!loading && (
              <span className="text-xs font-normal ml-1" style={{ color: "var(--text-secondary)" }}>
                ({filtered.length}{filtered.length !== allEpisodes.length ? ` av ${allEpisodes.length}` : ""})
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1">
            {/* Sort toggle */}
            <button
              onClick={() => setSortOrder((s) => (s === "newest" ? "oldest" : "newest"))}
              className="text-2xs px-2 py-0.5 rounded-md"
              style={pillStyle(false)}
              title={sortOrder === "newest" ? "Viser nyeste først" : "Viser eldste først"}
            >
              {sortOrder === "newest" ? "↓ Nyeste" : "↑ Eldste"}
            </button>
            {/* Filter toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-2xs px-2 py-0.5 rounded-md flex items-center gap-1"
              style={pillStyle(showAdvanced || !!hasActiveFilters)}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filter{hasActiveFilters ? " ●" : ""}
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Søk tittel, gjest, tema, emneord..."
            className="w-full h-8 px-xs pl-7 rounded-lg text-xs placeholder:text-[var(--text-secondary)]"
            style={{
              background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.90)",
              border: `1px solid ${inputFocused ? "rgba(0,114,114,0.45)" : isDark ? "rgba(255,255,255,0.07)" : "rgba(0,52,62,0.14)"}`,
              color: "var(--text-primary)",
              outline: "none",
              boxShadow: inputFocused ? "0 0 0 2px rgba(0,114,114,0.12)" : "none",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
          />
          <svg className="w-3.5 h-3.5 absolute left-2 top-[9px]" style={{ color: "var(--text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-[7px] text-xs" style={{ color: "var(--text-secondary)" }}>✕</button>
          )}
        </div>

        {/* Advanced filters */}
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="mt-xs space-y-xs">
                {/* Year */}
                <div className="flex items-center gap-xs">
                  <label className="text-2xs shrink-0 w-10" style={{ color: "var(--text-secondary)" }}>År</label>
                  <select
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    className="h-7 px-1.5 rounded-md text-2xs flex-1"
                    style={{
                      background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.9)",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,52,62,0.14)"}`,
                      color: "var(--text-primary)",
                      outline: "none",
                    }}
                  >
                    <option value="">Alle år</option>
                    {availableYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>

                {/* Duration pills */}
                <div className="flex items-center gap-xs">
                  <label className="text-2xs shrink-0 w-10" style={{ color: "var(--text-secondary)" }}>Lengde</label>
                  <div className="flex flex-wrap gap-1">
                    {DURATION_OPTIONS.map((opt, i) => (
                      <button
                        key={opt.label}
                        onClick={() => setDurationIdx(i)}
                        className="text-2xs px-2 py-0.5 rounded-full transition-all"
                        style={pillStyle(durationIdx === i)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Guest dropdown */}
                <div className="flex items-center gap-xs">
                  <label className="text-2xs shrink-0 w-10" style={{ color: "var(--text-secondary)" }}>Gjest</label>
                  <select
                    value={guestFilter}
                    onChange={(e) => setGuestFilter(e.target.value)}
                    className="h-7 px-1.5 rounded-md text-2xs flex-1"
                    style={{
                      background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.9)",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,52,62,0.14)"}`,
                      color: "var(--text-primary)",
                      outline: "none",
                    }}
                  >
                    <option value="">Alle gjester</option>
                    {availableGuests.map((g) => (
                      <option key={g.name} value={g.name}>{g.name} ({g.count})</option>
                    ))}
                  </select>
                </div>

                {/* Reset */}
                {hasActiveFilters && (
                  <button
                    onClick={() => { setYearFilter(""); setDurationIdx(0); setGuestFilter(""); }}
                    className="text-2xs underline"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Nullstill filter
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Episode list */}
      <div className="flex-1 overflow-y-auto p-md space-y-xs">
        {loading && (
          <div className="space-y-xs">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton h-20 rounded-xl" />
            ))}
          </div>
        )}

        {error && (
          <div
            className="rounded-xl p-sm text-xs"
            style={{
              background: "rgba(181,42,42,0.12)",
              border: "1px solid rgba(181,42,42,0.3)",
              color: "rgba(255,120,120,0.9)",
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-xl text-sm" style={{ color: "var(--text-secondary)" }}>
            <p>Ingen episoder funnet.</p>
            {(search || hasActiveFilters) && (
              <button
                onClick={() => { setSearch(""); setYearFilter(""); setDurationIdx(0); setGuestFilter(""); }}
                className="text-xs mt-xs underline"
                style={{ color: isDark ? "rgba(77,184,184,0.8)" : "#007272" }}
              >
                Nullstill søk og filter
              </button>
            )}
          </div>
        )}

        <AnimatePresence mode="wait">
          {!loading && filtered.length > 0 && (
            <motion.div
              key={`${search}-${yearFilter}-${durationIdx}-${guestFilter}-${sortOrder}`}
              variants={listVariants}
              initial="hidden"
              animate="visible"
              className="space-y-xs"
            >
              {filtered.map((ep) => (
                <motion.div key={ep.episode_number} variants={itemVariants}>
                  <EpisodeCard episode={ep} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
