"use client";

import { useState } from "react";
import type { SourceReference } from "@/types";

interface AnswerPanelProps {
  sources: SourceReference[];
  confidence: number;
}

export function AnswerPanel({ sources, confidence }: AnswerPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!sources.length) return null;

  const confidenceColor =
    confidence >= 0.7
      ? "text-success"
      : confidence >= 0.4
        ? "text-warning"
        : "text-error";

  return (
    <div className="mt-sm pt-sm border-t border-[var(--border-subtle)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-xs text-xs text-[var(--text-secondary)] hover:text-havgronn dark:hover:text-dm-accent transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        {sources.length} kilde{sources.length !== 1 ? "r" : ""}
        <span className={`${confidenceColor} font-medium`}>
          · {Math.round(confidence * 100)}% relevans
        </span>
      </button>

      {expanded && (
        <div className="mt-xs space-y-xs">
          {sources.map((src, i) => (
            <div
              key={i}
              className="rounded-lg bg-[var(--surface-elevated)] p-sm text-xs"
            >
              <div className="flex items-center gap-xs mb-1 flex-wrap">
                <span className="font-semibold text-havgronn dark:text-dm-accent">
                  Ep. {src.episode_number}
                </span>
                <span className="text-[var(--border-default)]">·</span>
                <span className="text-[var(--text-secondary)] font-medium truncate max-w-[140px]">{src.title}</span>
                <span className="text-[var(--border-default)]">·</span>
                <span className="text-[var(--text-secondary)]">{src.date}</span>
              </div>
              <p className="text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                {src.relevant_text}
              </p>
              <div className="mt-sm">
                <div className="w-full bg-[var(--border-default)] rounded-full h-1.5">
                  <div
                    className="bg-gradient-to-r from-sjogronn to-smaragd h-1.5 rounded-full"
                    style={{ width: `${Math.round(src.similarity * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
