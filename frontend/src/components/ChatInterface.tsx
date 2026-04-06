"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askQuestionStream, postFeedback } from "@/lib/api";
import type { ConversationMessage, QAFilters } from "@/types";
import { AnswerPanel } from "./AnswerPanel";
import { SearchFilters } from "./SearchFilters";
import { MemoryPanel } from "./MemoryPanel";
import { useIsDark } from "@/hooks/useTheme";
import { useUserId } from "@/hooks/useUserId";

const msgVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: "spring" as const, damping: 24, stiffness: 320 },
  },
  exit: { opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.15 } },
};

const suggestionVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: 0.3 + i * 0.07, duration: 0.3, ease: "easeOut" as const },
  }),
};

function preprocessWebCitations(text: string): string {
  const supMap: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  };
  return text.replace(/\[WEB (\d+)\]/g, (_match, num: string) =>
    num.split("").map((d) => supMap[d] ?? d).join("")
  );
}

export function ChatInterface() {
  const isDark = useIsDark();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [filters, setFilters] = useState<QAFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [model, setModel] = useState<string>("auto");
  const [useWeb, setUseWeb] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [feedbackState, setFeedbackState] = useState<Record<string, {
    thumbs: 0 | 1 | null;
    correctionOpen: boolean;
    correctionText: string;
    submitted: boolean;
  }>>({});
  const userId = useUserId();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // Stable ref to accumulate streamed content without re-renders per token
  const streamAccRef = useRef("");

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    const userMsg: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: ConversationMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };

    // Resolve "auto" to actual model: short questions (<80 chars) → Sonnet, longer → Opus
    const resolvedModel = model === "auto"
      ? (question.length < 80 ? "eu-sonnet-4-6" : "eu-opus-4-6")
      : model;

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setLoading(true);
    setStreaming(true);
    streamAccRef.current = "";

    // Batched token flushing — accumulate tokens and flush at ~30fps
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const snapshot = streamAccRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: snapshot } : m
          )
        );
      }, 33); // ~30fps
    };

    await askQuestionStream(
      question,
      {
        onSources: (sources, confidence) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, sources, confidence } : m
            )
          );
        },
        onToken: (text) => {
          streamAccRef.current += text;
          scheduleFlush();
        },
        onDone: () => {
          // Final flush
          if (flushTimer) clearTimeout(flushTimer);
          const finalContent = streamAccRef.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: finalContent } : m
            )
          );
          setLoading(false);
          setStreaming(false);
        },
        onError: (err) => {
          if (flushTimer) clearTimeout(flushTimer);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `Beklager, noe gikk galt: ${err.message}` }
                : m
            )
          );
          setLoading(false);
          setStreaming(false);
        },
      },
      Object.keys(filters).length > 0 ? filters : undefined,
      resolvedModel,
      useWeb,
      userId
    );
  }, [input, loading, filters, model, useWeb, userId]);

  const handleThumbsUp = useCallback((msgId: string) => {
    setFeedbackState((prev) => ({ ...prev, [msgId]: { ...(prev[msgId] ?? { correctionOpen: false, correctionText: "" }), thumbs: 1, submitted: true } }));
    const msgs = messages;
    const idx = msgs.findIndex((m) => m.id === msgId);
    const question = idx > 0 ? msgs[idx - 1].content : "";
    const answer = msgs[idx]?.content ?? "";
    if (userId) postFeedback(userId, question, answer, 1).catch(() => {/* silent */});
  }, [messages, userId]);

  const handleThumbsDown = useCallback((msgId: string) => {
    setFeedbackState((prev) => ({ ...prev, [msgId]: { ...(prev[msgId] ?? { thumbs: null, correctionText: "" }), thumbs: 0, correctionOpen: true, submitted: false } }));
  }, []);

  const handleSubmitCorrection = useCallback((msgId: string) => {
    setFeedbackState((prev) => {
      const entry = prev[msgId];
      if (!entry) return prev;
      const msgs = messages;
      const idx = msgs.findIndex((m) => m.id === msgId);
      const question = idx > 0 ? msgs[idx - 1].content : "";
      const answer = msgs[idx]?.content ?? "";
      if (userId) postFeedback(userId, question, answer, 0, entry.correctionText).catch(() => {/* silent */});
      return { ...prev, [msgId]: { ...entry, submitted: true, correctionOpen: false } };
    });
  }, [messages, userId]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-lg space-y-lg">
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            className="text-center py-3xl"
          >
            {/* Animated icon ring */}
            <div className="relative w-20 h-20 mx-auto mb-lg">
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background: "radial-gradient(circle, rgba(0,114,114,0.18) 0%, transparent 70%)",
                  border: "1px solid rgba(0,114,114,0.25)",
                }}
                animate={{ scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              />
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{
                  background: "rgba(0,114,114,0.10)",
                  border: "1px solid rgba(0,114,114,0.25)",
                  boxShadow: "0 0 24px rgba(0,114,114,0.2)",
                }}
              >
                <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: "rgba(77,184,184,0.85)" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
            </div>

            <h2 className="text-2xl font-semibold tracking-tight gradient-text mb-xs">
              Spør om Utbytte-podcasten
            </h2>
            <p className="text-sm leading-relaxed max-w-md mx-auto" style={{ color: "var(--text-secondary)" }}>
              Still spørsmål om episoder, temaer, gjester, eller hva som helst
              annet fra podcasten. AI-assistenten søker gjennom alle
              transkripsjoner for å finne svaret.
            </p>

            <div className="mt-lg flex flex-wrap justify-center gap-xs">
              {[
                "Hvilke gjester har truffet best på makro-prediksjoner, og hva kjennetegner resonneringen deres?",
                "Sammenlign synet på inflasjon og renter i 2020, 2022 og 2024 på tvers av episoder.",
                "Hvor er det tydelig uenighet mellom gjester om AI, energi og verdsettelse?",
                "Lag en kronologisk utvikling av synet på norsk krone og hvilke drivere som går igjen.",
                "Hvilke episoder utfordrer hverandre mest i debatten indeksfond vs aktiv forvaltning?",
                "Finn temaer som går igjen i ulike sektorer, og trekk linjer mellom episoder som ikke er åpenbart koblet.",
              ].map((suggestion, i) => (
                <motion.button
                  key={suggestion}
                  custom={i}
                  variants={suggestionVariants}
                  initial="hidden"
                  animate="visible"
                  whileHover={{
                    scale: 1.04,
                    boxShadow: "0 0 16px rgba(0,114,114,0.3)",
                    borderColor: "rgba(0,114,114,0.5)",
                  }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setInput(suggestion)}
                  className="text-xs px-sm py-2xs rounded-full font-medium transition-colors"
                  style={{
                    background: isDark ? "rgba(0,114,114,0.08)" : "rgba(0,52,62,0.06)",
                    border: isDark ? "1px solid rgba(0,114,114,0.22)" : "1px solid rgba(0,52,62,0.18)",
                    color: isDark ? "rgba(77,184,184,0.85)" : "#00343E",
                  }}
                >
                  {suggestion}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              variants={msgVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className="max-w-[80%] p-md rounded-2xl"
                style={
                  msg.role === "user"
                    ? {
                        background: "linear-gradient(135deg, #007272 0%, #14555A 100%)",
                        color: "rgba(255,255,255,0.95)",
                        borderRadius: "18px 18px 4px 18px",
                        boxShadow: "0 4px 16px rgba(0,114,114,0.35)",
                        border: "1px solid rgba(77,184,184,0.2)",
                      }
                    : {
                        background: isDark ? "rgba(12, 30, 38, 0.85)" : "rgba(255,255,255,0.92)",
                        border: isDark ? "1px solid rgba(0,114,114,0.18)" : "1px solid rgba(0,52,62,0.12)",
                        borderRadius: "18px 18px 18px 4px",
                        boxShadow: isDark ? "0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)" : "0 2px 12px rgba(0,52,62,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
                      }
                }
              >
                {msg.role === "assistant" ? (
                  <div className="text-sm leading-relaxed break-words space-y-2">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                      h1: ({ children }) => <h1 className="text-lg font-semibold mt-1 mb-2">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-base font-semibold mt-1 mb-1">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-semibold mt-1 mb-1">{children}</h3>,
                      p: ({ children }) => <p className="text-sm leading-relaxed whitespace-pre-wrap">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
                      li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                      code: ({ children }) => (
                        <code
                          className="px-1 py-0.5 rounded text-xs"
                          style={{
                            background: isDark
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(0,52,62,0.08)",
                          }}
                        >
                          {children}
                        </code>
                      ),
                      }}
                    >
                      {preprocessWebCitations(msg.content || "")}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                )}
                {msg.role === "assistant" && msg.content === "" && streaming && msg.id === messages[messages.length - 1]?.id && (
                  <div className="flex items-center gap-xs">
                    <div className="flex gap-1 items-end">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: "rgba(77,184,184,0.7)" }}
                          animate={{ y: [0, -5, 0], opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
                        />
                      ))}
                    </div>
                    <span className="text-xs italic" style={{ color: "var(--text-secondary)" }}>
                      Søker i arkivet...
                    </span>
                  </div>
                )}
                {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                  <AnswerPanel
                    sources={msg.sources}
                    confidence={msg.confidence ?? 0}
                  />
                )}
                {msg.role === "assistant" && msg.content && (() => {
                  const fb = feedbackState[msg.id];
                  if (fb?.submitted) {
                    return (
                      <p className="mt-2 text-xs" style={{ color: isDark ? "rgba(134,239,172,0.7)" : "#166534" }}>
                        ✓ Takk for tilbakemeldingen
                      </p>
                    );
                  }
                  return (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Nyttig?</span>
                        <button
                          onClick={() => handleThumbsUp(msg.id)}
                          className="text-base leading-none hover:scale-110 transition-transform"
                          title="Bra svar"
                        >👍</button>
                        <button
                          onClick={() => handleThumbsDown(msg.id)}
                          className="text-base leading-none hover:scale-110 transition-transform"
                          title="Dårlig svar"
                        >👎</button>
                      </div>
                      {fb?.correctionOpen && (
                        <div className="mt-2 space-y-1">
                          <textarea
                            value={fb.correctionText}
                            onChange={(e) => setFeedbackState((prev) => ({ ...prev, [msg.id]: { ...prev[msg.id], correctionText: e.target.value } }))}
                            placeholder="Hva burde svaret ha vært? (valgfritt)"
                            rows={2}
                            maxLength={500}
                            className="w-full text-xs rounded-lg px-2 py-1.5 resize-none"
                            style={{
                              background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,52,62,0.05)",
                              border: isDark ? "1px solid rgba(0,114,114,0.3)" : "1px solid rgba(0,52,62,0.15)",
                              color: "var(--text-primary)",
                              outline: "none",
                            }}
                          />
                          <button
                            onClick={() => handleSubmitCorrection(msg.id)}
                            className="text-xs px-3 py-1 rounded-lg font-medium"
                            style={{
                              background: "rgba(0,114,114,0.15)",
                              border: "1px solid rgba(0,114,114,0.35)",
                              color: isDark ? "rgba(77,184,184,0.9)" : "#007272",
                            }}
                          >Send tilbakemelding</button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
            style={{ borderTop: "1px solid rgba(0,114,114,0.15)" }}
          >
            <div className="px-lg py-sm">
              <SearchFilters filters={filters} onChange={setFilters} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Memory panel */}
      <AnimatePresence>
        {showMemory && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
            style={{ borderTop: "1px solid rgba(139,92,246,0.15)" }}
          >
            <MemoryPanel userId={userId} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area */}
      <div
        className="p-md"
        style={{ borderTop: "1px solid rgba(0,114,114,0.15)" }}
      >
        <form onSubmit={handleSubmit} className="flex gap-xs items-end">
          {/* Filter toggle */}
          <motion.button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-colors"
            style={
              showFilters
                ? { background: "rgba(0,114,114,0.2)", border: "1px solid rgba(0,114,114,0.5)", color: "rgba(77,184,184,0.9)", boxShadow: "0 0 12px rgba(0,114,114,0.25)" }
                : { background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,52,62,0.05)", border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,52,62,0.10)", color: "var(--text-secondary)" }
            }
            title="Avgrens s\u00F8ket etter episodenummer eller datoperiode"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </motion.button>

          {/* Model picker */}
          <div className="relative">
            <motion.button
              type="button"
              onClick={() => setShowModelPicker(!showModelPicker)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
              className="shrink-0 h-11 px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors"
              style={
                model === "eu-opus-4-6"
                  ? { background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.5)", color: "rgba(167,139,250,0.95)", boxShadow: "0 0 12px rgba(139,92,246,0.25)" }
                  : model === "eu-sonnet-4-6"
                  ? { background: "rgba(0,114,114,0.18)", border: "1px solid rgba(0,114,114,0.5)", color: isDark ? "rgba(77,184,184,0.95)" : "#007272", boxShadow: "0 0 12px rgba(0,114,114,0.25)" }
                  : { background: "linear-gradient(135deg, rgba(0,114,114,0.12), rgba(139,92,246,0.12))", border: "1px solid rgba(0,114,114,0.35)", color: isDark ? "rgba(200,200,200,0.9)" : "#00343E" }
              }
              title="Velg AI-modell"
            >
              {model === "auto" && (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              )}
              {model === "eu-sonnet-4-6" && (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              )}
              {model === "eu-opus-4-6" && (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
              )}
              {model === "auto" ? "Auto" : model === "eu-sonnet-4-6" ? "Sonnet" : "Opus"}
              <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </motion.button>

            {/* Model picker dropdown */}
            <AnimatePresence>
              {showModelPicker && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full mb-2 left-0 w-72 rounded-xl p-1.5 z-50"
                  style={{
                    background: isDark ? "rgba(8, 22, 28, 0.97)" : "rgba(255,255,255,0.98)",
                    border: isDark ? "1px solid rgba(0,114,114,0.25)" : "1px solid rgba(0,52,62,0.15)",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
                    backdropFilter: "blur(20px)",
                  }}
                >
                  <p className="text-2xs font-medium px-2 pt-1 pb-1.5 uppercase tracking-wider" style={{ color: isDark ? "rgba(140,160,170,0.85)" : "#5a6b73" }}>Velg AI-modell</p>
                  {[
                    { id: "auto", name: "Auto", desc: "Velger automatisk: Sonnet for korte sp\u00F8rsm\u00E5l, Opus for komplekse.", icon: "\u26A1", accent: isDark ? "linear-gradient(135deg, rgba(0,114,114,0.15), rgba(139,92,246,0.15))" : "linear-gradient(135deg, rgba(0,114,114,0.08), rgba(139,92,246,0.08))", borderC: isDark ? "rgba(0,114,114,0.35)" : "rgba(0,114,114,0.25)" },
                    { id: "eu-sonnet-4-6", name: "Sonnet", desc: "Rask og kostnadseffektiv. Best for korte sp\u00F8rsm\u00E5l, daglige oppgaver og enkle oppsummeringer.", icon: "\u{1F3CE}\uFE0F", accent: isDark ? "rgba(0,114,114,0.12)" : "rgba(0,114,114,0.06)", borderC: isDark ? "rgba(0,114,114,0.4)" : "rgba(0,114,114,0.3)" },
                    { id: "eu-opus-4-6", name: "Opus", desc: "Dypere tenker. Ideell for komplekse analyser, sammenligning p\u00E5 tvers av episoder og avansert resonnering.", icon: "\u{1F9E0}", accent: isDark ? "rgba(139,92,246,0.12)" : "rgba(139,92,246,0.06)", borderC: isDark ? "rgba(139,92,246,0.4)" : "rgba(139,92,246,0.3)" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => { setModel(opt.id); setShowModelPicker(false); }}
                      className="w-full text-left rounded-lg p-2.5 mb-0.5 transition-all"
                      style={{
                        background: model === opt.id ? opt.accent : "transparent",
                        border: model === opt.id ? `1px solid ${opt.borderC}` : "1px solid transparent",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{opt.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold" style={{ color: isDark ? "rgba(230,235,240,0.95)" : "#1a2b33" }}>{opt.name}</span>
                            {model === opt.id && (
                              <span className="text-2xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: "rgba(0,114,114,0.15)", color: isDark ? "rgba(77,184,184,0.9)" : "#007272" }}>aktiv</span>
                            )}
                          </div>
                          <p className="text-2xs mt-0.5 leading-relaxed" style={{ color: isDark ? "rgba(160,175,185,0.8)" : "#4a5b63" }}>{opt.desc}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Web toggle */}
          <motion.button
            type="button"
            onClick={() => setUseWeb((v) => !v)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            className="shrink-0 h-11 px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors"
            style={
              useWeb
                ? {
                    background: "rgba(22,163,74,0.16)",
                    border: "1px solid rgba(22,163,74,0.45)",
                    color: isDark ? "rgba(134,239,172,0.95)" : "#166534",
                    boxShadow: "0 0 12px rgba(22,163,74,0.2)",
                  }
                : {
                    background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,52,62,0.05)",
                    border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,52,62,0.10)",
                    color: "var(--text-secondary)",
                  }
            }
            title="Web-modus: inkluderer oppdaterte nettkilder og merker disse som [WEB n] i svaret"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18M12 3a15 15 0 000 18" />
            </svg>
            {useWeb ? "Web på" : "Web av"}
          </motion.button>

          {/* Memory toggle */}
          <motion.button
            type="button"
            onClick={() => { setShowMemory((v) => !v); setShowFilters(false); setShowModelPicker(false); }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            className="shrink-0 h-11 px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors"
            style={
              showMemory
                ? { background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.5)", color: isDark ? "rgba(167,139,250,0.95)" : "#5b21b6", boxShadow: "0 0 12px rgba(139,92,246,0.25)" }
                : { background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,52,62,0.05)", border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,52,62,0.10)", color: "var(--text-secondary)" }
            }
            title="Mine instruksjoner og tilbakemeldinger"
          >
            🧠 Minne
          </motion.button>

          {/* Input with animated glow */}
          <div className="relative flex-1">
            <motion.div
              className="absolute inset-0 rounded-xl pointer-events-none"
              animate={inputFocused
                ? { opacity: 1, boxShadow: "0 0 0 2px rgba(0,114,114,0.4), 0 0 20px rgba(0,114,114,0.2)" }
                : { opacity: 0 }
              }
              transition={{ duration: 0.2 }}
            />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="Still et spørsmål om podcasten..."
              className="w-full h-11 px-sm rounded-xl text-sm placeholder:text-[var(--text-secondary)] disabled:opacity-50"
              style={{
                background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.90)",
                border: `1px solid ${inputFocused ? "rgba(0,114,114,0.5)" : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,52,62,0.14)"}`,
                color: "var(--text-primary)",
                outline: "none",
                transition: "border-color 0.2s",
              }}
              disabled={loading}
            />
          </div>

          {/* Submit button */}
          <motion.button
            type="submit"
            disabled={loading || !input.trim()}
            whileHover={!loading && input.trim() ? { scale: 1.04, boxShadow: "0 0 20px rgba(0,114,114,0.5)" } : {}}
            whileTap={!loading && input.trim() ? { scale: 0.95 } : {}}
            className="shrink-0 h-11 px-lg rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, #007272 0%, #14555A 100%)",
              color: "rgba(255,255,255,0.95)",
              border: "1px solid rgba(77,184,184,0.2)",
              boxShadow: "0 2px 8px rgba(0,114,114,0.3)",
            }}
          >
            Spør
          </motion.button>
        </form>
      </div>
    </div>
  );
}
