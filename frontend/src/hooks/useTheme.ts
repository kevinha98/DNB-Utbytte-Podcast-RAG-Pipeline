"use client";

import { useState, useEffect } from "react";

/**
 * Reactively tracks whether the <html> element has the "dark" class.
 * Works with the ThemeToggle component that mutates document.documentElement.classList.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(true); // default dark

  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
