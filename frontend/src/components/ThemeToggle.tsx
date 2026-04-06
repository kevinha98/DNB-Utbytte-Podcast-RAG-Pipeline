"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";

export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    // On mount, check for stored preference or default to dark
    const stored = localStorage.getItem("theme");
    if (stored === "light") {
      setDark(false);
      document.documentElement.classList.remove("dark");
    } else {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  return (
    <motion.button
      onClick={toggle}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      className="relative w-[52px] h-[28px] rounded-full flex items-center p-[3px] cursor-pointer"
      style={{
        background: dark
          ? "rgba(0,114,114,0.25)"
          : "rgba(255,255,255,0.20)",
        border: `1px solid ${dark ? "rgba(0,114,114,0.45)" : "rgba(0,0,0,0.12)"}`,
        boxShadow: dark
          ? "0 0 10px rgba(0,114,114,0.2), inset 0 1px 0 rgba(255,255,255,0.05)"
          : "0 1px 4px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.8)",
      }}
      aria-label={dark ? "Bytt til lyst tema" : "Bytt til mørkt tema"}
    >
      <motion.div
        className="w-[22px] h-[22px] rounded-full flex items-center justify-center"
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        style={{
          marginLeft: dark ? "22px" : "0px",
          background: dark
            ? "linear-gradient(135deg, #007272, #4DB8B8)"
            : "linear-gradient(135deg, #FDB813, #F5A623)",
          boxShadow: dark
            ? "0 0 8px rgba(0,114,114,0.6)"
            : "0 0 8px rgba(245,166,35,0.5)",
        }}
      >
        {dark ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        )}
      </motion.div>
    </motion.button>
  );
}
