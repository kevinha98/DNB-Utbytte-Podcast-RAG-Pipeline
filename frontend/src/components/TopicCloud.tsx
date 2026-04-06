"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getTopics } from "@/lib/api";
import type { TopicEntry } from "@/types";

export function TopicCloud() {
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTopics()
      .then((res) => setTopics(res.topics))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-md">
        <div className="skeleton h-4 w-32 mb-sm rounded" />
        <div className="flex flex-wrap gap-xs">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="skeleton h-6 w-16 rounded-full" />
          ))}
        </div>
      </div>
    );
  }

  const freq: Record<string, number> = {};
  for (const t of topics) {
    for (const kw of t.keywords) {
      freq[kw] = (freq[kw] || 0) + 1;
    }
  }

  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 28);
  if (!sorted.length) return null;

  const maxFreq = sorted[0][1];

  return (
    <div className="p-md" style={{ borderTop: "1px solid rgba(0,114,114,0.12)" }}>
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-sm" style={{ color: "rgba(77,184,184,0.65)" }}>
        Populære temaer
      </h3>
      <div className="flex flex-wrap gap-1">
        {sorted.map(([keyword, count], i) => {
          const intensity = count / maxFreq;
          const fontSize =
            intensity > 0.7 ? "0.75rem" : intensity > 0.4 ? "0.7rem" : "0.65rem";
          const px = intensity > 0.7 ? "10px" : intensity > 0.4 ? "8px" : "6px";

          return (
            <motion.span
              key={keyword}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05 * i, duration: 0.25, ease: "easeOut" }}
              whileHover={{ scale: 1.1, y: -1 }}
              whileTap={{ scale: 0.95 }}
              className="inline-block rounded-full cursor-pointer font-medium"
              style={{
                fontSize,
                padding: `3px ${px}`,
                background: intensity > 0.5 ? "rgba(0,114,114,0.15)" : "rgba(0,114,114,0.07)",
                border: `1px solid ${intensity > 0.5 ? "rgba(0,114,114,0.35)" : "rgba(0,114,114,0.15)"}`,
                color: intensity > 0.6 ? "rgba(77,184,184,0.9)" : "rgba(77,184,184,0.55)",
                boxShadow: intensity > 0.7 ? "0 0 8px rgba(0,114,114,0.2)" : "none",
                transition: "background 0.15s, border-color 0.15s",
              }}
              title={`${count} episode${count > 1 ? "r" : ""}`}
            >
              {keyword}
            </motion.span>
          );
        })}
      </div>
    </div>
  );
}
