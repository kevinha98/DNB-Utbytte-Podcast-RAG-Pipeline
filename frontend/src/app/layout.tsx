import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiConfig } from "../components/ApiConfig";
import "./globals.css";

export const metadata: Metadata = {
  title: "Utbytte – Podcast AI Assistant",
  description:
    "Spør om hva som helst fra Utbytte-podcasten av DNB. Drevet av AI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="no" className="dark" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col" style={{ background: "var(--surface-bg)" }}>
        {/* Header — deep glass with teal glow line */}
        <header className="sticky top-0 z-50 header-glass">
          {/* Teal gradient line at top edge */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "1px",
              background: "linear-gradient(90deg, transparent 0%, rgba(0,114,114,0.6) 30%, rgba(77,184,184,0.8) 50%, rgba(0,114,114,0.6) 70%, transparent 100%)",
            }}
          />
          <div className="max-w-content mx-auto px-md py-sm flex items-center justify-between">
            <div className="flex items-center gap-sm">
              {/* Logo with glow ring */}
              <div
                className="relative"
                style={{
                  filter: "drop-shadow(0 0 8px rgba(0,114,114,0.45))",
                }}
              >
                <Image
                  src="/utbytte_logo.jpeg"
                  alt="Utbytte"
                  width={38}
                  height={38}
                  className="rounded-xl object-cover"
                  style={{
                    boxShadow: "0 0 0 1px rgba(0,114,114,0.4), 0 0 0 3px rgba(0,114,114,0.12)",
                  }}
                  priority
                />
              </div>
              <div>
                <h1
                  className="text-base font-semibold leading-tight tracking-tight gradient-text"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  Utbytte
                </h1>
                <p
                  className="text-[10px] uppercase tracking-widest"
                  style={{ color: "rgba(77,184,184,0.55)" }}
                >
                  Podcast AI Assistant
                </p>
              </div>
            </div>
            <nav className="flex items-center gap-sm text-xs">
              <span
                className="hidden sm:inline text-[11px] text-muted-adaptive"
              >
                DNB Private Banking
              </span>
              <Link
                href="/om"
                className="hidden sm:inline text-[11px] font-medium transition-opacity hover:opacity-80"
                style={{ color: "rgba(0,114,114,0.75)" }}
              >
                Om systemet
              </Link>
              <ApiConfig />
              <ThemeToggle />
            </nav>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 relative">{children}</main>

        {/* Footer */}
        <footer className="footer-bar" style={{ padding: "12px 0" }}>
          <div className="max-w-content mx-auto px-md flex items-center justify-between text-[10px]">
            <span>DNB Wealth Management Investment Office</span>
            <span className="hidden sm:inline">
              Claude · ChromaDB · faster-whisper · oppdatert {new Date().toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
