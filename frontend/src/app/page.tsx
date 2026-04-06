"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChatInterface } from "@/components/ChatInterface";
import { EpisodeList } from "@/components/EpisodeList";
import { TopicCloud } from "@/components/TopicCloud";
import { PipelineBanner } from "@/components/PipelineBanner";
import { useIsDark } from "@/hooks/useTheme";

const panelVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: i * 0.08,
      duration: 0.5,
      ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
    },
  }),
};

export default function Home() {
  const isDark = useIsDark();
  const [showSidebar, setShowSidebar] = useState(false);

  const panelStyle = isDark
    ? {
        background: "rgba(8, 22, 28, 0.75)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        border: "1px solid rgba(0, 114, 114, 0.18)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)",
      }
    : {
        background: "rgba(255, 255, 255, 0.82)",
        backdropFilter: "blur(28px) saturate(160%)",
        WebkitBackdropFilter: "blur(28px) saturate(160%)",
        border: "1px solid rgba(0, 52, 62, 0.12)",
        boxShadow: "0 4px 24px rgba(0,52,62,0.08), 0 1px 4px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
      };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSidebar(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-100px)] overflow-hidden">
      {/* ── Animated background ── */}
      <div className="absolute inset-0 bg-grid opacity-60 pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="orb orb-1" style={{ top: "-120px", left: "-80px" }} />
        <div className="orb orb-2" style={{ bottom: "-100px", right: "-60px" }} />
        <div className="orb orb-3" style={{ top: "40%", left: "55%" }} />
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 max-w-content mx-auto px-md py-md h-[calc(100vh-100px)]">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <PipelineBanner />
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-md h-full">
          {/* Left: Chat */}
          <motion.div
            custom={0}
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            className="rounded-2xl overflow-hidden flex flex-col min-h-0"
            style={panelStyle}
          >
            <ChatInterface />
          </motion.div>

          {/* Right: Sidebar */}
          <motion.div
            custom={1}
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            className="hidden lg:flex flex-col rounded-2xl overflow-hidden min-h-0"
            style={panelStyle}
          >
            <div className="flex-1 overflow-hidden">
              <EpisodeList />
            </div>
            <TopicCloud />
          </motion.div>
        </div>

        {/* Mobile: Floating button */}
        <motion.button
          onClick={() => setShowSidebar(true)}
          className="lg:hidden fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, #007272, #14555A)",
            boxShadow: "0 0 20px rgba(0,114,114,0.5), 0 4px 12px rgba(0,0,0,0.4)",
            border: "1px solid rgba(77,184,184,0.3)",
            color: "white",
          }}
          whileHover={{ scale: 1.08, boxShadow: "0 0 28px rgba(0,114,114,0.7), 0 4px 16px rgba(0,0,0,0.5)" }}
          whileTap={{ scale: 0.94 }}
          aria-label="Vis episoder"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </motion.button>

        {/* Mobile: Drawer */}
        <AnimatePresence>
          {showSidebar && (
            <>
              <motion.div
                className="lg:hidden fixed inset-0 z-40"
                style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setShowSidebar(false)}
              />
              <motion.div
                className="lg:hidden fixed inset-y-0 right-0 z-50 w-[85vw] max-w-[400px] flex flex-col"
                style={{
                  ...panelStyle,
                  borderRadius: "20px 0 0 20px",
                  border: "1px solid rgba(0,114,114,0.22)",
                }}
                initial={{ x: "100%", opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "100%", opacity: 0 }}
                transition={{ type: "spring", damping: 28, stiffness: 280 }}
              >
                <div
                  className="flex items-center justify-between px-md py-sm"
                  style={{ borderBottom: "1px solid rgba(0,114,114,0.15)" }}
                >
                  <span className="text-sm font-semibold gradient-text">Episoder &amp; temaer</span>
                  <button
                    onClick={() => setShowSidebar(false)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                    style={{ color: "var(--text-secondary)" }}
                    aria-label="Lukk"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <EpisodeList />
                </div>
                <TopicCloud />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
