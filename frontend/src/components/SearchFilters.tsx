"use client";

import type { QAFilters } from "@/types";

interface SearchFiltersProps {
  filters: QAFilters;
  onChange: (filters: QAFilters) => void;
}

const activeCount = (f: QAFilters) =>
  (f.episode_numbers ? 1 : 0) + (f.date_from ? 1 : 0) + (f.date_to ? 1 : 0);

export function SearchFilters({ filters, onChange }: SearchFiltersProps) {
  const count = activeCount(filters);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            Avgrens søket
          </h4>
          <p className="text-2xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            Begrens hvilke episoder AI-en søker i. Nyttig for å fokusere på en bestemt tidsperiode eller spesifikke episoder.
          </p>
        </div>
        {count > 0 && (
          <button
            onClick={() => onChange({})}
            className="text-2xs px-2 py-1 rounded-md transition-colors hover:bg-red-500/10"
            style={{ color: "var(--error, #ef4444)" }}
          >
            Nullstill ({count})
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        {/* Episode numbers */}
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Episodenummer
          </label>
          <input
            type="text"
            placeholder="f.eks. 1, 5, 10"
            value={filters.episode_numbers?.join(", ") ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              const nums = val
                .split(",")
                .map((s) => parseInt(s.trim()))
                .filter((n) => !isNaN(n));
              onChange({
                ...filters,
                episode_numbers: nums.length > 0 ? nums : undefined,
              });
            }}
            className="h-8 px-2 rounded-lg text-xs w-36 focus:outline-none focus:ring-2 focus:ring-[rgba(0,114,114,0.5)] transition-shadow"
            style={{
              background: "var(--surface-bg)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          />
          <span className="text-2xs" style={{ color: "var(--text-secondary)" }}>Kommaseparerte tall</span>
        </div>

        {/* Date from */}
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Fra dato
          </label>
          <input
            type="date"
            value={filters.date_from ?? ""}
            onChange={(e) =>
              onChange({ ...filters, date_from: e.target.value || undefined })
            }
            className="h-8 px-2 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[rgba(0,114,114,0.5)] transition-shadow"
            style={{
              background: "var(--surface-bg)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          />
          <span className="text-2xs" style={{ color: "var(--text-secondary)" }}>Eldste episode</span>
        </div>

        {/* Date to */}
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Til dato
          </label>
          <input
            type="date"
            value={filters.date_to ?? ""}
            onChange={(e) =>
              onChange({ ...filters, date_to: e.target.value || undefined })
            }
            className="h-8 px-2 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[rgba(0,114,114,0.5)] transition-shadow"
            style={{
              background: "var(--surface-bg)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          />
          <span className="text-2xs" style={{ color: "var(--text-secondary)" }}>Nyeste episode</span>
        </div>
      </div>
    </div>
  );
}
