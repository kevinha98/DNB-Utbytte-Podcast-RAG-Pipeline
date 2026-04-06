"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getPipelineStatus } from "@/lib/api";
import type { PipelineStatus } from "@/types";

export function PipelineBanner() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const check = async () => {
      try {
        const data = await getPipelineStatus();
        setStatus(data);
        if (data.is_running && !interval) {
          interval = setInterval(check, 5000);
        } else if (!data.is_running && interval) {
          clearInterval(interval);
        }
      } catch {
        setStatus(null);
      }
    };
    check();
    interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!status || (!status.is_running && !status.finished_at)) return null;
  if (status.finished_at) {
    const ago = Date.now() - new Date(status.finished_at).getTime();
    if (ago > 5 * 60 * 1000) return null;
  }

  const pct = status.total_episodes > 0
    ? Math.round((status.completed / status.total_episodes) * 100) : 0;
  const isRunning = status.is_running;
  const isDone = !isRunning && status.finished_at;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8, height: 0 }}
        animate={{ opacity: 1, y: 0, height: "auto" }}
        exit={{ opacity: 0, y: -8, height: 0 }}
        className="mb-md overflow-hidden"
      >
        <div
          className="rounded-xl p-sm flex items-center gap-sm text-xs"
          style={
            isDone
              ? {
                  background: "rgba(27,122,74,0.12)",
                  border: "1px solid rgba(27,122,74,0.3)",
                  boxShadow: "0 0 16px rgba(27,122,74,0.1)",
                }
              : {
                  background: "rgba(0,114,114,0.08)",
                  border: "1px solid rgba(0,114,114,0.22)",
                  boxShadow: "0 0 16px rgba(0,114,114,0.1)",
                }
          }
        >
          {/* Icon */}
          <div className="shrink-0">
            {isRunning ? (
              <motion.div
                className="w-5 h-5 rounded-full"
                style={{
                  border: "2px solid rgba(0,114,114,0.25)",
                  borderTopColor: "rgba(77,184,184,0.9)",
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
              />
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: "rgba(27,200,100,0.85)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>

          {/* Text + progress */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium" style={{ color: isDone ? "rgba(77,200,120,0.9)" : "rgba(77,184,184,0.9)" }}>
                {isRunning
                  ? `Transkriberer episoder... (${status.current_step})`
                  : "Pipeline ferdig!"}
              </span>
              <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {status.completed}/{status.total_episodes}
                {status.failed > 0 && (
                  <span className="ml-1" style={{ color: "rgba(255,100,100,0.8)" }}>
                    ({status.failed} feilet)
                  </span>
                )}
              </span>
            </div>
            {isRunning && (
              <div
                className="w-full rounded-full overflow-hidden"
                style={{ height: "3px", background: "rgba(0,114,114,0.15)" }}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg, #007272, #4DB8B8)" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                />
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
