"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";
import { useIsDark } from "@/hooks/useTheme";

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.45, ease: [0.34, 1.1, 0.64, 1] as const },
  }),
};

const PIPELINE_STEPS = [
  {
    num: "01",
    tag: "Innsamling \u2013 gj\u00F8res \u00E9n gang",
    title: "RSS-feed og oversikt over episoder",
    plain:
      "Systemet leser den offentlige podcast-feeden til Utbytte (Acast) og holder oversikt over alle 580 episoder. Det sjekker hvilke episoder som allerede er prosessert, og planlegger kun nye.",
    tech: "PlannerAgent parser RSS-feeden og sammenligner med et lokalt manifest (JSON) for \u00E5 identifisere uprosesserte episoder.",
  },
  {
    num: "02",
    tag: "Innsamling \u2013 gj\u00F8res \u00E9n gang",
    title: "Nedlasting av lydfilene",
    plain:
      "Lydfilen (MP3) til hver episode lastes ned automatisk. St\u00F8rrelsen er typisk 30\u201380 MB per episode. Etter at transkripsjonen er ferdig slettes lydfilen for \u00E5 spare lagringsplass.",
    tech: "DownloaderAgent henter MP3-er via HTTPS med gjenfors\u00F8k og fremdriftssporing. Lagres midlertidig i storage/audio/.",
  },
  {
    num: "03",
    tag: "Innsamling \u2013 gj\u00F8res \u00E9n gang",
    title: "Transkripsjon \u2014 tale til tekst (Whisper)",
    plain:
      "En lokal AI-modell kalt Whisper \u00ABlytter\u00BB gjennom lydfilene og skriver ned alt som sies, med tidskoder. En times lydopptak tar ca. 5\u201310 minutter \u00E5 transkribere. Transkripsjonen lagres som tekstfiler og er s\u00F8kbar.",
    tech: "TranscriberAgent bruker faster-whisper p\u00E5 CPU (Whisper small-modell, int8-kvantisering). Produserer .jsonl (tidsstemplede segmenter) og .md (lesbar tekst per episode).",
  },
  {
    num: "04",
    tag: "Innsamling \u2013 gj\u00F8res \u00E9n gang",
    title: "Oppdeling i biter (chunking)",
    plain:
      "En transkripsjon kan inneholde 10 000 ord. For \u00E5 gj\u00F8re s\u00F8k effektivt deles teksten opp i overlappende \u00ABbiter\u00BB p\u00E5 ca. 750 ord. Overlapp p\u00E5 100 ord sikrer at setninger ikke mister kontekst der skillelinjene faller.",
    tech: "ChunkerAgent splitter p\u00E5 setningsgrenser, 750 tokens per bit og 100 tokens overlapp. Bruker sentence-transformers-tokenisering.",
  },
  {
    num: "05",
    tag: "Innsamling \u2013 gj\u00F8res \u00E9n gang",
    title: "Vektorisering (embedding)",
    plain:
      "Hver tekstbit konverteres til en liste med 384 tall \u2014 en \u00ABvektor\u00BB. Vektorer som er matematisk n\u00E6re hverandre betyr at tekstene handler om det samme temaet. Dette gj\u00F8r det mulig \u00E5 s\u00F8ke etter mening, ikke bare n\u00F8yaktige ord.",
    tech: "ChunkerAgent bruker sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 (kj\u00F8res lokalt, ingen API-n\u00F8kkel). 384-dimensjonale vektorer, st\u00F8tter norsk.",
  },
  {
    num: "06",
    tag: "Innsamling \u2013 gj\u00F8res \u00E9n gang",
    title: "Lagring i vektordatabasen (ChromaDB)",
    plain:
      "Vektorene og de tilh\u00F8rende tekstbitene lagres varig i en spesiell database kalt ChromaDB. Tenk p\u00E5 den som et bibliotek der alt er sortert etter meningsinnhold, ikke alfabetisk \u2014 slik at du raskt finner det som faktisk er relevant.",
    tech: "DatabaseAgent upserter chunks med metadata (episode_id, tidskode, tittel, dato) i ChromaDB. Totalt ~11 800 chunks fra alle 580 indekserte episoder.",
  },
  {
    num: "07",
    tag: "Live \u2013 kj\u00F8res per sp\u00F8rsm\u00E5l",
    title: "Multi-query s\u00F8k med full transkripsjon",
    plain:
      "N\u00E5r du stiller et sp\u00F8rsm\u00E5l, genererer systemet tre alternative formuleringer for \u00E5 fange flere nyanser. Alle fire sp\u00F8rsm\u00E5lene (originalt + 3 varianter) s\u00F8kes parallelt mot ~11 800 vektorer. De beste treffene samles, og den mest relevante episoden hentes i sin helhet \u2014 slik at AI-en kan lese hele samtalen, ikke bare korte utdrag.",
    tech: "QAAgent ekspanderer sp\u00F8rsm\u00E5let til 3 alternative norske s\u00F8kesp\u00F8rsm\u00E5l via LLM. Alle 4 (original + 3) kj\u00F8res mot ChromaDB (30 resultater per query). Resultater sammensl\u00E5s per chunk-ID, filtreres ved 40% terskel og kappes ved 80 chunks. Den best-matchende episodens fulle .md-transkripsjon leses fra disk (opptil 30 000 tokens).",
  },
  {
    num: "08",
    tag: "Live \u2013 kj\u00F8res per sp\u00F8rsm\u00E5l",
    title: "AI genererer svar med kildehenvisninger (Claude)",
    plain:
      "Konteksten \u2014 en full transkripsjon pluss utdrag fra flere episoder \u2014 sendes til Claude (Anthropic) sammen med sp\u00F8rsm\u00E5let ditt. Claude leser alt og formulerer et sammenhengende svar p\u00E5 norsk, med kildehenvisninger til episodenummer og tidskode slik at du kan verifisere. Du kan velge mellom Sonnet (rask) og Opus (grundig), eller la Auto-modus bestemme.",
    tech: "QAAgent kaller Claude Sonnet 4.6 eller Opus 4.6 via Radical Gateway (EU-basert proxy, OpenAI-kompatibelt API). Streaming (SSE) gir token-for-token visning. Systempromptet instruerer modellen til \u00E5 svare p\u00E5 norsk og alltid sitere episode og tidskode.",
  },
];

const LIMITATIONS = [
  {
    title: "Alle 580 episoder er indeksert",
    desc: "Per april 2026 er alle 580 episoder transkribert og indeksert. Nye episoder legges til automatisk.",
  },
  {
    title: "AI kan ta feil (hallusinering)",
    desc: "Store spr\u00E5kmodeller kan produsere overbevisende-klingende svar som ikke er faktisk korrekte. Sjekk alltid kildehenvisningene, og lytt til den aktuelle episoden ved viktige beslutninger.",
  },
  {
    title: "Kontekstvindu og dybde",
    desc: "Systemet henter opptil 80 relevante tekstbiter + 1 full episodetranskripsjon per sp\u00F8rsm\u00E5l. Sv\u00E6rt bredt spredt informasjon kan likevel bli ufullstendig.",
  },
  {
    title: "Norsk prim\u00E6rspr\u00E5k",
    desc: "Transkripsjonsmodellen og embedding-modellen er optimalisert for norsk. Engelske sp\u00F8rsm\u00E5l fungerer, men norsk gir best treffsikkerhet.",
  },
  {
    title: "Backend p\u00E5 Railway",
    desc: "Backend kj\u00F8rer p\u00E5 Railway (cloud). Ved nedetid eller deploy fungerer episodlisten fortsatt, men AI-sp\u00F8rringer krever aktiv backend.",
  },
];

const GLOSSARY = [
  {
    term: "RAG",
    full: "Retrieval-Augmented Generation",
    desc: "En AI-teknikk der modellen henter faktisk informasjon fra en kjent kilde (her: transkripsjoner) før den genererer svaret. Motsetningen er ren generering der modellen stoler på treningsdata alene — noe som er langt mer utsatt for feil og foreldede fakta.",
  },
  {
    term: "Embedding / Vektor",
    full: "Numerisk representasjon av tekst",
    desc: "En matematisk teknikk der tekst konverteres til en liste med tall. Setninger med lignende mening får tallvektorer som er matematisk nære hverandre — noe som muliggjør meningsbasert søk fremfor nøkkelordmatch.",
  },
  {
    term: "Chunking",
    full: "Oppdeling i overlappende tekstbiter",
    desc: "Lange tekster deles i biter for effektiv indeksering og søk. Overlapp (100 ord) sikrer at viktig kontekst ikke «faller mellom» to biter der en setning kuttes.",
  },
  {
    term: "ChromaDB",
    full: "Vektordatabase (embedded)",
    desc: "En database spesialisert for vektorlagring og kosinuslikhets-søk. Kjøres lokalt — ingen sky-API. Returnerer de n mest relevante fragmentene for et gitt spørsmål basert på matematisk nærhet.",
  },
  {
    term: "Whisper",
    full: "Talegjenkjenningsmodell (OpenAI)",
    desc: "En åpen kildekode-modell som konverterer lyd til tekst. Kjøres lokalt. 'Small'-varianten gir god nøyaktighet på norsk med rimelig hastighet på CPU.",
  },
  {
    term: "Kosinuslikhet",
    full: "Cosine similarity — matematisk nærhetsmål",
    desc: "En score mellom 0 og 1 som måler vinkelen mellom to vektorer. Score nær 1.0 betyr at to tekstbiter handler om det samme. Brukes til å finne de mest relevante episodbitene for et spørsmål.",
  },
  {
    term: "Claude (Sonnet / Opus)",
    full: "Anthropics store spr\u00E5kmodeller (LLM)",
    desc: "Modellene som formulerer det endelige svaret. Sonnet er rask og kostnadseffektiv. Opus er grundigere for komplekse analyser. Begge aksesseres via Radical Gateway (EU). Brukes kun for svarskriving \u2014 faktaene hentes fra ChromaDB.",
  },
  {
    term: "LLM",
    full: "Large Language Model — stor språkmodell",
    desc: "En AI-modell trent på enorme mengder tekst for å forstå og generere menneskelig språk. Eksempler: GPT-4, Claude, Gemini. Brukes her kun som «skriveassistent» basert på hentet kontekst.",
  },
  {
    term: "sentence-transformers",
    full: "Lokal embeddingmodell",
    desc: "Et Python-bibliotek som kjører embeddingmodeller lokalt. Ingen data sendes til sky for dette steget. Modellen paraphrase-multilingual-MiniLM-L12-v2 er valgt for god norsk støtte med lav ressursbruk.",
  },
];

export default function OmPage() {
  const isDark = useIsDark();
  const [openTech, setOpenTech] = useState<string | null>(null);
  const [openGloss, setOpenGloss] = useState<string | null>(null);

  const card = {
    background: isDark ? "rgba(8, 22, 28, 0.65)" : "rgba(255,255,255,0.88)",
    border: `1px solid ${isDark ? "rgba(0,114,114,0.18)" : "rgba(0,52,62,0.12)"}`,
    boxShadow: isDark
      ? "0 2px 12px rgba(0,0,0,0.3)"
      : "0 2px 12px rgba(0,52,62,0.06), 0 1px 3px rgba(0,0,0,0.04)",
  };

  const tagColor = isDark ? "rgba(77,184,184,0.75)" : "#007272";
  const tagBg = isDark ? "rgba(0,114,114,0.10)" : "rgba(0,114,114,0.07)";
  const tagBorder = isDark ? "rgba(0,114,114,0.22)" : "rgba(0,114,114,0.18)";

  const techBg = isDark ? "rgba(0,114,114,0.08)" : "rgba(0,52,62,0.05)";
  const techBorder = isDark ? "rgba(0,114,114,0.15)" : "rgba(0,52,62,0.10)";
  const techColor = isDark ? "rgba(77,184,184,0.75)" : "#14555A";

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="orb orb-1" style={{ top: "-100px", left: "-80px" }} />
        <div className="orb orb-2" style={{ bottom: "-80px", right: "-60px" }} />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-md py-xl">

        {/* Back link */}
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }}>
          <Link
            href="/"
            className="inline-flex items-center gap-xs text-sm font-medium mb-xl"
            style={{ color: isDark ? "rgba(77,184,184,0.8)" : "#00343E" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Tilbake til Utbytte AI
          </Link>
        </motion.div>

        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <motion.div custom={0} variants={fadeUp} initial="hidden" animate="visible" className="mb-2xl">
          <h1 className="text-3xl font-semibold tracking-tight gradient-text mb-sm">
            Slik fungerer Utbytte AI
          </h1>
          <p className="text-base leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            En enkel forklaring for alle — uavhengig av teknisk bakgrunn. Fra lydfil til
            AI-generert svar på norsk.
          </p>
        </motion.div>

        {/* ── HVA ER DETTE ─────────────────────────────────────────────── */}
        <motion.section custom={1} variants={fadeUp} initial="hidden" animate="visible" className="mb-2xl">
          <h2 className="text-lg font-semibold mb-md" style={{ color: "var(--text-primary)" }}>
            Hva er dette verktøyet?
          </h2>
          <div className="rounded-2xl p-lg" style={card}>
            <p className="text-sm leading-relaxed mb-sm" style={{ color: "var(--text-primary)" }}>
              <strong>Utbytte AI</strong> er et internt søke- og spørreverktøy for DNB Private
              Banking / WMIO. Du kan stille sp\u00F8rsm\u00E5l p\u00E5 norsk om innholdet i alle 580 episoder
              av podcasten «Utbytte» og få svar med kildehenvisninger til konkrete episoder og
              tidkoder.
            </p>
            <p className="text-sm leading-relaxed mb-sm" style={{ color: "var(--text-primary)" }}>
              I motsetning til vanlig tekstsøk forstår systemet <em>meningen</em> bak spørsmålet —
              ikke bare nøkkelordene. Du kan for eksempel spørre:
            </p>
            <ul className="text-sm space-y-xs pl-md" style={{ color: "var(--text-secondary)" }}>
              <li>«Hva sier podcasten om norske renter i 2023?»</li>
              <li>«Hvilke episoder handler om ESG og bærekraft?»</li>
              <li>«Hva er fordelene med indeksfond sammenlignet med aktivt forvaltede fond?»</li>
            </ul>
            <p className="mt-sm text-sm" style={{ color: "var(--text-secondary)" }}>
              Svarene inkluderer alltid <strong>kildehenvisninger</strong> — episodenummer, tittel
              og tidkode — slik at du enkelt kan lytte til originalen og verifisere.
            </p>
          </div>
        </motion.section>

        {/* ── PIPELINE STEG ────────────────────────────────────────────── */}
        <motion.section custom={2} variants={fadeUp} initial="hidden" animate="visible" className="mb-2xl">
          <h2 className="text-lg font-semibold mb-xs" style={{ color: "var(--text-primary)" }}>
            Steg for steg: hva skjer bak kulissene?
          </h2>
          <p className="text-sm mb-lg" style={{ color: "var(--text-secondary)" }}>
            Prosessen har to faser: <strong>innsamling</strong> (gjøres én gang per episode) og{" "}
            <strong>spørring</strong> (kjøres live hvert gang du stiller et spørsmål). Klikk
            «Tekniske detaljer» på hvert steg hvis du vil se mer.
          </p>

          {/* Step separator labels */}
          <div className="space-y-xs">
            {PIPELINE_STEPS.map((step, i) => {
              const isLive = step.tag.startsWith("Live");
              const isFirst = i === 0 || (isLive && !PIPELINE_STEPS[i - 1].tag.startsWith("Live"));
              return (
                <div key={step.num}>
                  {isFirst && i > 0 && (
                    <div className="flex items-center gap-sm my-md">
                      <div className="flex-1 h-px" style={{ background: isDark ? "rgba(0,114,114,0.20)" : "rgba(0,52,62,0.12)" }} />
                      <span className="text-xs font-medium px-sm py-2xs rounded-full" style={{ background: tagBg, border: `1px solid ${tagBorder}`, color: tagColor }}>
                        Live-fase: per spørsmål
                      </span>
                      <div className="flex-1 h-px" style={{ background: isDark ? "rgba(0,114,114,0.20)" : "rgba(0,52,62,0.12)" }} />
                    </div>
                  )}
                  <motion.div
                    custom={i * 0.4 + 2}
                    variants={fadeUp}
                    initial="hidden"
                    animate="visible"
                    className="rounded-xl overflow-hidden"
                    style={card}
                  >
                    <div className="p-md">
                      <div className="flex items-start gap-sm">
                        {/* Step number */}
                        <div
                          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                          style={{
                            background: "linear-gradient(135deg, #007272, #00343E)",
                            color: "white",
                            boxShadow: "0 0 10px rgba(0,114,114,0.3)",
                          }}
                        >
                          {step.num}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                            {step.title}
                          </h3>
                          <p className="text-sm leading-relaxed mb-xs" style={{ color: "var(--text-secondary)" }}>
                            {step.plain}
                          </p>

                          {/* Expandable tech detail */}
                          <button
                            onClick={() => setOpenTech(openTech === step.num ? null : step.num)}
                            className="text-xs font-medium flex items-center gap-1"
                            style={{ color: techColor }}
                          >
                            <svg
                              className="w-3 h-3 transition-transform duration-200"
                              style={{ transform: openTech === step.num ? "rotate(180deg)" : "rotate(0)" }}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            {openTech === step.num ? "Skjul tekniske detaljer" : "Tekniske detaljer"}
                          </button>

                          {openTech === step.num && (
                            <p
                              className="mt-xs text-xs leading-relaxed p-xs rounded-lg"
                              style={{ color: techColor, background: techBg, border: `1px solid ${techBorder}` }}
                            >
                              🔧 {step.tech}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </div>
              );
            })}
          </div>
        </motion.section>

        {/* ── RAG FORKLART ─────────────────────────────────────────────── */}
        <motion.section custom={5} variants={fadeUp} initial="hidden" animate="visible" className="mb-2xl">
          <h2 className="text-lg font-semibold mb-md" style={{ color: "var(--text-primary)" }}>
            Hva er RAG — og hvorfor brukes det?
          </h2>
          <div className="rounded-2xl p-lg" style={card}>
            <p className="text-sm leading-relaxed mb-md" style={{ color: "var(--text-primary)" }}>
              <strong>RAG</strong> (Retrieval-Augmented Generation) løser et grunnleggende problem
              med AI-chatbotter: de «vet» bare det de ble trent på, og kan ikke søke i ny eller
              spesifikk informasjon — som et podcastarkiv.
            </p>

            {/* Analogy box */}
            <div
              className="rounded-xl p-md mb-md"
              style={{ background: techBg, border: `1px solid ${techBorder}` }}
            >
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
                <strong>📚 Tenk på det som en smart biblioteksjef:</strong>
              </p>
              <p className="text-sm leading-relaxed mt-xs" style={{ color: "var(--text-secondary)" }}>
                Du stiller et spørsmål. Biblioteksjefet (AI) går inn i arkivet (ChromaDB), finner
                de mest relevante boksidene (chunks) pluss ett helt kapittel, legger dem p\u00E5 skrivebordet, og formulerer
                deretter svaret ditt basert på <em>faktisk innhold</em> — ikke fra hukommelsen
                alene. Du får også vite hvilke bøker det er hentet fra.
              </p>
            </div>

            <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Uten RAG ville Claude bare gjette basert p\u00E5 generell treningsdata \u2014 som ikke
              inneholder Utbytte-spesifikt innhold. Med RAG «limer» vi relevante episodbiter
              direkte inn i konteksten, og svaret er forankret i faktiske episoder med kildehenvisning.
            </p>
          </div>
        </motion.section>

        {/* ── BEGRENSNINGER ────────────────────────────────────────────── */}
        <motion.section custom={6} variants={fadeUp} initial="hidden" animate="visible" className="mb-2xl">
          <h2 className="text-lg font-semibold mb-xs" style={{ color: "var(--text-primary)" }}>
            Begrensninger og forutsetninger
          </h2>
          <p className="text-sm mb-md" style={{ color: "var(--text-secondary)" }}>
            Det er viktig å kjenne til disse begrensningene når du bruker og vurderer systemet —
            særlig ved compliance-gjennomgang.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
            {LIMITATIONS.map((lim, i) => (
              <motion.div
                key={lim.title}
                custom={i * 0.2 + 6}
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                className="rounded-xl p-md"
                style={{
                  ...card,
                  borderLeft: `3px solid ${isDark ? "rgba(0,114,114,0.55)" : "#007272"}`,
                }}
              >
                <h3 className="text-sm font-semibold mb-xs" style={{ color: "var(--text-primary)" }}>
                  {lim.title}
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {lim.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ── PERSONVERN ───────────────────────────────────────────────── */}
        <motion.section custom={8} variants={fadeUp} initial="hidden" animate="visible" className="mb-2xl">
          <h2 className="text-lg font-semibold mb-md" style={{ color: "var(--text-primary)" }}>
            Personvern og datasikkerhet
          </h2>
          <div
            className="rounded-2xl p-lg space-y-sm"
            style={{ ...card, borderLeft: `3px solid ${isDark ? "rgba(77,184,184,0.5)" : "#14555A"}` }}
          >
            {[
              { icon: "✅", text: "Lydfiler slettes automatisk etter transkripsjon — lagres ikke permanent." },
              { icon: "✅", text: "Transkripsjoner er basert på offentlig tilgjengelig podcastinnhold fra Acast." },
              { icon: "✅", text: "Vektorisering (embedding) kjøres 100 % lokalt — ingen tekstdata sendes til sky for dette steget." },
              {
                icon: "\u2705",
                text: "Sp\u00F8rsm\u00E5l sendes til Claude (Anthropic) via Radical Gateway \u2014 en EU-basert proxy som sikrer at data ikke forlater Europa. Unng\u00E5 likevel \u00E5 inkludere personopplysninger, kundenavn eller konfidensiell forretningsinformasjon i sp\u00F8rsm\u00E5lene.",
              },
              { icon: "\u2705", text: "Systemet er ment for internt bruk i WMIO / Private Banking. Ikke del tilgangsinformasjon eksternt." },
              { icon: "\u2139\uFE0F", text: "Radical Gateway er DNBs godkjente AI-gateway for bruk av Claude-modeller i EU. Sjekk med IT/juridisk avdeling ved behov for ytterligere DPA-vurdering." },
            ].map((item) => (
              <div key={item.text} className="flex items-start gap-sm">
                <span className="text-base shrink-0 mt-0.5">{item.icon}</span>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </motion.section>

        {/* ── ORDLISTE ─────────────────────────────────────────────────── */}
        <motion.section custom={9} variants={fadeUp} initial="hidden" animate="visible" className="mb-2xl">
          <h2 className="text-lg font-semibold mb-xs" style={{ color: "var(--text-primary)" }}>
            Ordliste
          </h2>
          <p className="text-sm mb-md" style={{ color: "var(--text-secondary)" }}>
            Tekniske begreper forklart enkelt. Klikk for å åpne.
          </p>
          <div className="space-y-xs">
            {GLOSSARY.map((item) => (
              <div key={item.term} className="rounded-xl overflow-hidden" style={card}>
                <button
                  onClick={() => setOpenGloss(openGloss === item.term ? null : item.term)}
                  className="w-full text-left p-md flex items-center justify-between gap-sm"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-semibold" style={{ color: isDark ? "rgba(77,184,184,0.9)" : "#00343E" }}>
                      {item.term}
                    </span>
                    <span className="text-xs ml-sm" style={{ color: "var(--text-secondary)" }}>
                      {item.full}
                    </span>
                  </div>
                  <svg
                    className="w-4 h-4 shrink-0 transition-transform duration-200"
                    style={{
                      transform: openGloss === item.term ? "rotate(180deg)" : "rotate(0)",
                      color: "var(--text-secondary)",
                    }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openGloss === item.term && (
                  <div
                    className="px-md pb-md"
                    style={{ borderTop: `1px solid ${isDark ? "rgba(0,114,114,0.12)" : "rgba(0,52,62,0.08)"}` }}
                  >
                    <p className="pt-sm text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      {item.desc}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.section>

        {/* ── TEKNISK SAMMENDRAG ───────────────────────────────────────── */}
        <motion.section custom={10} variants={fadeUp} initial="hidden" animate="visible" className="mb-2xl">
          <h2 className="text-lg font-semibold mb-md" style={{ color: "var(--text-primary)" }}>
            Teknisk sammendrag
          </h2>
          <div className="rounded-2xl p-lg" style={card}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-sm">
              {[
                { label: "Frontend", value: "Next.js 14 · React 18 · Tailwind" },
                { label: "Backend", value: "Python 3.14 \u00B7 FastAPI \u00B7 uvicorn" },
                { label: "Transkripsjon", value: "faster-whisper (Whisper large-v3, CPU)" },
                { label: "Embedding", value: "sentence-transformers MiniLM (lokal)" },
                { label: "Vektordatabase", value: "ChromaDB (embedded, lokal)" },
                { label: "Spr\u00E5kmodell", value: "Claude Sonnet / Opus 4.6 (Radical Gateway EU)" },
                { label: "Episoder totalt", value: "580 (Utbytte, Acast)" },
                { label: "Indeksert (april 2026)", value: "580 / 580 episoder" },
                { label: "Kildekode", value: "github.com/kevinha98/DNB-Utbytte-Podcast-RAG-Pipeline" },
              ].map((row) => (
                <div
                  key={row.label}
                  className="p-xs rounded-lg"
                  style={{ background: techBg, border: `1px solid ${techBorder}` }}
                >
                  <div
                    className="text-2xs uppercase tracking-wider mb-1"
                    style={{ color: tagColor }}
                  >
                    {row.label}
                  </div>
                  <div className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* ── BACK BUTTON ─────────────────────────────────────────────── */}
        <motion.div custom={11} variants={fadeUp} initial="hidden" animate="visible" className="text-center pb-xl">
          <Link
            href="/"
            className="inline-flex items-center gap-xs px-lg py-sm rounded-xl text-sm font-medium"
            style={{
              background: "linear-gradient(135deg, #007272, #00343E)",
              color: "white",
              boxShadow: "0 4px 16px rgba(0,114,114,0.35)",
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Gå til Utbytte AI
          </Link>
        </motion.div>

      </div>
    </div>
  );
}
