from __future__ import annotations

import json
import logging
import re
from collections.abc import Generator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import tiktoken
from openai import OpenAI

from agents.base import AgentMessage, AgentResult, BaseAgent
from agents.chunker import _get_shared_model
from agents.database import DatabaseAgent
from config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Du er en spesialisert analytiker og assistent for podcasten "Utbytte" av DNB, vert Marius Brun Haugen.
Du har tilgang til transkripsjoner fra alle episoder og fungerer som en ekspert som husker, kobler og analyserer på tvers av hele arkivet.

## IDENTITET OG ROLLE
- Du er en dedikert podcastanalytiker med dyp kjennskap til Utbytte-universet og norsk finansmarked generelt.
- Du kjenner Marius sin intervjustil, faste gjester, tilbakevendende temaer og terminologi.
- Du tenker som en analytiker: identifiser mønstre, motstridende synspunkter og utvikling over tid.
- Du kan også svare på generelle finansspørsmål basert på din kunnskap — gjør det tydelig når du svarer fra generell kunnskap vs. hva som ble sagt i podcasten.

## SVARSPRÅK
- Svar på norsk med mindre brukeren skriver på engelsk.
- Bruk finansfaglig språk tilpasset målgruppen (norske privatinvestorer og fagpersoner).

## KILDEBRUK OG REFERANSER
- Henvis alltid til episodenummer og tittel ved påstander hentet fra transkripsjoner.
- Bruk direkte sitater sparsomt men presist — marker alltid med anførselstegn og kildehenvisning.
- Skille tydelig mellom: (1) hva som faktisk ble sagt i podcasten, (2) din tolkning/analyse, og (3) generell finanskunnskap.
- Hvis samme tema er dekket i flere episoder, nevn alle relevante episoder.

## ANALYTISKE KAPABILITETER
Du skal aktivt kunne:
- **Trendanalyse**: Identifisere hvordan synspunkter på aksjer, sektorer eller markeder har endret seg over tid.
- **Gjesteprofiler**: Huske hvem som har vært gjest, hva de representerer, og hva de har uttalt seg om.
- **Temakartlegging**: Koble episoder som berører samme selskap, sektor, makrotema eller investeringsstrategi.
- **Kontradiksjoner**: Flagge hvis ulike gjester eller Marius selv har hatt motstridende syn.
- **Siteringshukommelse**: Huske spesifikke utsagn, anbefalinger eller prediksjoner som ble gitt.
- **Generell finansrådgivning**: Forklare begreper, markedsmekanismer og investeringsprinsipper.

## STRUKTURERING AV SVAR
- Bruk overskrifter og punktlister ved komplekse svar.
- Start gjerne med en kortfattet direktebesvarelse (TL;DR), deretter utdypning.
- Ved trendspørsmål: strukturer kronologisk eller etter tema.
- Ved faktaspørsmål: svar direkte, referer kilde.

## REFERANSEFORMAT
- Når du refererer til en episode, bruk formatet: **Episode {nummer}: "{tittel}"** ({dato})
- Eksempel: **Episode 567: "Kjernekraft og investeringer med Jonas Nøland og Eivind Aukrust"** (2026-02-03)
- Hvis gjestens navn fremgår av tittelen eller transkripsjonen, nevn gjesten i referansen.

## ÆRLIGHET OG BEGRENSNINGER
- Hvis et tema ikke er dekket i transkripsjoner: si det, og svar gjerne fra generell kunnskap med tydelig markering.
- Skil klart mellom fakta fra podcast og egne slutninger eller generell kunnskap.

## WEB-KILDER (NÅR OPPGITT I KONTEKST)
- Hvis du får en egen seksjon med web-kilder, betyr det at systemet har hentet oppdatert nettkontekst for spørsmålet.
- Ikke svar at du "ikke kan sjekke nettet" når WEB-KILDER finnes i prompten.
- Merk påstander fra web med [WEB 1], [WEB 2], osv.
- Hold podcast-funn og web-funn tydelig adskilt i svaret.
- Avslutt alltid med en kort seksjon "Kilder (web)" med URL-er når WEB-KILDER er brukt.
"""


class QAAgent(BaseAgent):
    """Retrieval-augmented generation agent using local embeddings + ChromaDB + Groq."""

    def __init__(self, database_agent: DatabaseAgent) -> None:
        super().__init__("qa")
        self._db = database_agent

    def _call_llm(self, system: str, user: str, model: str | None = None) -> str:
        """Call LLM via Radical Gateway (OpenAI-compatible API)."""
        client = OpenAI(
            base_url=settings.llm_url,
            api_key=settings.llm_api_key,
        )
        response = client.chat.completions.create(
            model=model or settings.llm_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=2048,
            temperature=0.3,
        )
        content = response.choices[0].message.content or ""
        # Strip Qwen3 thinking tags (chain-of-thought reasoning)
        content = re.sub(r"<think>[\s\S]*?</think>\s*", "", content)
        return content.strip()

    def _call_llm_stream(
        self, system: str, user: str, model: str | None = None
    ) -> Generator[str, None, None]:
        """Streaming LLM call — yields text deltas, strips <think> tags on the fly."""
        client = OpenAI(
            base_url=settings.llm_url,
            api_key=settings.llm_api_key,
        )
        stream = client.chat.completions.create(
            model=model or settings.llm_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=2048,
            temperature=0.3,
            stream=True,
        )
        inside_think = False
        buf = ""
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta is None:
                continue
            buf += delta
            # Suppress <think>...</think> blocks
            while True:
                if not inside_think:
                    tag_start = buf.find("<think>")
                    if tag_start == -1:
                        # Flush everything except a trailing partial "<" sequence
                        safe = len(buf)
                        for i in range(1, min(8, len(buf) + 1)):
                            if buf[-i:] == "<think>"[:i]:
                                safe = len(buf) - i
                                break
                        if safe > 0:
                            yield buf[:safe]
                            buf = buf[safe:]
                        break
                    else:
                        if tag_start > 0:
                            yield buf[:tag_start]
                        buf = buf[tag_start + 7:]  # skip "<think>"
                        inside_think = True
                else:
                    tag_end = buf.find("</think>")
                    if tag_end == -1:
                        break  # wait for more data
                    buf = buf[tag_end + 8:]
                    inside_think = False
        # Flush remainder
        if buf and not inside_think:
            yield buf

    @staticmethod
    def _extract_guest_from_title(title: str) -> str | None:
        """Best-effort guest extraction from episode title (e.g. 'med Jonas Nøland')."""
        m = re.search(r"\bmed\s+(.+)$", title, re.IGNORECASE)
        return m.group(1).strip() if m else None

    def _build_sources(
        self, chunks: list[tuple[str, dict, float]]
    ) -> tuple[list[dict[str, Any]], float]:
        """Build source list and confidence from chunks."""
        sources: list[dict[str, Any]] = []
        seen: set = set()
        for doc, meta, dist in chunks:
            ep_num = meta.get("episode_number")
            if ep_num not in seen:
                seen.add(ep_num)
                title = meta.get("title", "")
                sources.append(
                    {
                        "episode_number": ep_num,
                        "title": title,
                        "date": meta.get("date", ""),
                        "url": meta.get("url", ""),
                        "relevant_text": doc[:300],
                        "similarity": round(1 - dist, 3),
                        "guest": self._extract_guest_from_title(title),
                    }
                )
        distances = [dist for _, _, dist in chunks]
        confidence = (
            round(sum(1 - d for d in distances) / len(distances), 3)
            if distances
            else 0.0
        )
        return sources, confidence

    def _expand_queries(self, question: str) -> list[str]:
        """Use LLM to generate 3 alternative search queries for broader retrieval."""
        prompt = (
            f"Generer 3 alternative søkespørringer for å finne relevante podcastutdrag om samme tema.\n"
            f"Dekk ulike vinkler og begreper som kan dukke opp i norske finanstranskripsjoner.\n"
            f"Svar KUN med de 3 spørsmålene, ett per linje, ingen nummerering eller forklaring.\n\n"
            f"Originalspørsmål: {question}"
        )
        try:
            raw = self._call_llm("Du er en søkehjelper for en norsk finanspodcast.", prompt)
            queries = [q.strip() for q in raw.strip().splitlines() if q.strip()][:3]
            queries.insert(0, question)  # always include the original
            return list(dict.fromkeys(queries))  # deduplicate, preserve order
        except Exception:
            return [question]

    async def run(self, message: AgentMessage) -> AgentResult:
        question: str = message.payload
        filters = message.metadata.get("filters", {})
        model_override: str | None = message.metadata.get("model")
        use_web: bool = bool(message.metadata.get("use_web", False))

        if not question or not question.strip():
            return AgentResult(success=False, error="Empty question")

        import asyncio

        loop = asyncio.get_event_loop()

        # Step 1: Expand question into multiple search queries
        await self._report_progress(5, "Expanding query...")
        queries = await loop.run_in_executor(None, self._expand_queries, question)

        # Step 2: Search ChromaDB for each query, merge by chunk ID keeping best similarity
        await self._report_progress(20, "Searching vector database...")
        where = self._build_where_filter(filters)
        merged: dict[str, tuple[str, dict, float]] = {}  # id -> (doc, meta, dist)

        for q in queries:
            embedding = await loop.run_in_executor(None, self._embed_query, q)
            results = await loop.run_in_executor(
                None, self._db.query, embedding, 30, where
            )
            if not results or not results.get("documents") or not results["documents"][0]:
                continue
            ids = results.get("ids", [[]])[0]
            docs = results["documents"][0]
            metas = results["metadatas"][0]
            dists = results["distances"][0]
            for chunk_id, doc, meta, dist in zip(ids, docs, metas, dists):
                if chunk_id not in merged or dist < merged[chunk_id][2]:
                    merged[chunk_id] = (doc, meta, dist)

        if not merged:
            await self._report_progress(
                30, "Vector search empty, using transcript fallback..."
            )
            sorted_chunks = await loop.run_in_executor(
                None, self._fallback_chunks_from_transcripts, question, 20
            )
            if not sorted_chunks:
                return AgentResult(
                    success=True,
                    data={
                        "answer": "Beklager, jeg fant ingen relevante episoder for dette spørsmålet.",
                        "sources": [],
                        "confidence": 0.0,
                    },
                )
        else:
            # Step 3: Sort by similarity, filter by threshold, cap at 80 chunks
            sorted_chunks = sorted(merged.values(), key=lambda x: x[2])
        SIMILARITY_THRESHOLD = 0.40
        relevant = [
            (d, m, dist) for d, m, dist in sorted_chunks if (1 - dist) >= SIMILARITY_THRESHOLD
        ]
        if not relevant:
            relevant = sorted_chunks[:15]  # fallback if nothing clears threshold
        relevant = relevant[:80]

        await self._report_progress(50, "Loading full transcripts...")

        # Step 4: Read full transcripts for top episodes
        context = await loop.run_in_executor(
            None, self._build_context_with_full_transcripts, relevant
        )

        web_context = ""
        web_hits: list[dict[str, str]] = []
        if use_web:
            await self._report_progress(55, "Searching web sources...")
            web_hits = await loop.run_in_executor(None, self._search_web, question, 5)
            web_context = self._build_web_context(web_hits)

        await self._report_progress(60, "Generating answer with LLM...")

        answer_data = await loop.run_in_executor(
            None,
            self._generate_answer_from_chunks,
            question,
            context,
            relevant,
            model_override,
            web_context,
            web_hits,
        )

        await self._report_progress(100, "Done")
        return AgentResult(success=True, data=answer_data)

    def _embed_query(self, text: str) -> list[float]:
        """Embed a query using the same local sentence-transformers model as the chunker."""
        model = _get_shared_model()
        embedding = model.encode(text, normalize_embeddings=True)
        return embedding.tolist()

    def _build_where_filter(self, filters: dict) -> dict | None:
        conditions = []

        if ep_nums := filters.get("episode_numbers"):
            if len(ep_nums) == 1:
                conditions.append({"episode_number": {"$eq": ep_nums[0]}})
            else:
                conditions.append({"episode_number": {"$in": ep_nums}})

        if date_from := filters.get("date_from"):
            conditions.append({"date": {"$gte": date_from}})

        if date_to := filters.get("date_to"):
            conditions.append({"date": {"$lte": date_to}})

        if not conditions:
            return None
        if len(conditions) == 1:
            return conditions[0]
        return {"$and": conditions}

    def _fallback_chunks_from_transcripts(
        self, question: str, limit: int = 20
    ) -> list[tuple[str, dict, float]]:
        """Lexical fallback when Chroma retrieval returns no chunks.

        Useful during cold starts while vector index is rebuilding.
        """
        transcript_dir = Path(settings.transcript_dir)
        if not transcript_dir.exists():
            return []

        stop_words = {
            "hva", "hvor", "hvordan", "hvilke", "hvilken", "hvem", "som",
            "med", "for", "om", "til", "fra", "den", "det", "de", "jeg",
            "du", "vi", "en", "et", "på", "i", "av", "er", "og", "eller",
            "kan", "vil", "skal", "ble", "blir", "har", "hadde", "ikke",
        }
        terms = [
            t
            for t in re.findall(r"[a-zA-ZæøåÆØÅ]{3,}", question.lower())
            if t not in stop_words
        ]
        if not terms:
            q = question.strip().lower()
            if q:
                terms = [q[:20]]
        if not terms:
            return []

        candidates: list[tuple[str, dict, float]] = []
        for md_file in transcript_dir.glob("*.md"):
            stem = md_file.stem
            try:
                ep_num = int(stem.split("_", 1)[0])
            except (ValueError, IndexError):
                continue

            slug = stem.split("_", 1)[1] if "_" in stem else stem
            title = slug.replace("-", " ").strip().title()
            date = ""
            url = ""

            try:
                text = md_file.read_text(encoding="utf-8-sig")
            except OSError:
                continue

            body = text
            if text.startswith("---"):
                end = text.find("---", 3)
                if end != -1:
                    front = text[3:end]
                    body = text[end + 3 :].strip()

                    title_m = re.search(r"^title:\s*(.+)$", front, re.MULTILINE)
                    if title_m:
                        title = title_m.group(1).strip().strip('"\'')

                    date_m = re.search(r"^date:\s*(.+)$", front, re.MULTILINE)
                    if date_m:
                        date = date_m.group(1).strip().strip('"\'')

                    url_m = re.search(r"^url:\s*(.+)$", front, re.MULTILINE)
                    if url_m:
                        url = url_m.group(1).strip().strip('"\'')

            combined = f"{title}\n{body}".lower()
            hits = sum(1 for t in terms if t in combined)
            if hits == 0:
                continue

            pos = -1
            for t in terms:
                p = combined.find(t)
                if p != -1 and (pos == -1 or p < pos):
                    pos = p
            if pos == -1:
                pos = 0

            start = max(0, pos - 220)
            end = min(len(body), start + 750)
            snippet = body[start:end].strip() or body[:750].strip()

            # Pseudo-distance from lexical hit quality (smaller is better)
            distance = max(0.05, 1.0 - min(0.95, hits / max(1, len(terms))))

            candidates.append(
                (
                    snippet,
                    {
                        "episode_number": ep_num,
                        "title": title,
                        "date": date,
                        "url": url,
                    },
                    distance,
                )
            )

        candidates.sort(key=lambda x: x[2])
        return candidates[:limit]

    def _web_query_variants(self, question: str) -> list[str]:
        """Use LLM to generate 2-3 targeted web search queries for current financial news."""
        q = question.strip()
        if not q:
            return []
        prompt = (
            f"Lag 2-3 korte, målrettede søkespørringer for å finne AKTUELLE nyheter og data "
            f"om dette finanstemaet på nettet (DuckDuckGo/Reuters/Bloomberg).\n"
            f"Svar KUN med spørringene, én per linje, ingen nummerering eller forklaring.\n"
            f"Bland gjerne norsk og engelsk. Prioriter presise termer som gir svar fra "
            f"Reuters, Bloomberg, SSB eller Norges Bank.\n\n"
            f"Spørsmål: {q}"
        )
        try:
            raw = self._call_llm(
                "Du er en søkeekspert for finansnyheter. Generer presise websøkespørringer.",
                prompt,
            )
            variants = [v.strip() for v in raw.strip().splitlines() if v.strip()][:3]
            variants.insert(0, q)
            return list(dict.fromkeys(variants))
        except Exception:
            return [q, f"{q} latest Reuters Bloomberg"]

    def _score_web_hit(self, question: str, title: str, snippet: str, url: str) -> float:
        stop_words = {
            "hva", "hvor", "hvordan", "hvilke", "hvilken", "hvem", "som",
            "med", "for", "om", "til", "fra", "den", "det", "de", "jeg",
            "du", "vi", "en", "et", "på", "i", "av", "er", "og", "eller",
            "kan", "vil", "skal", "ble", "blir", "har", "hadde", "ikke",
        }
        terms = [
            t for t in re.findall(r"[a-zA-ZæøåÆØÅ]{3,}", question.lower())
            if t not in stop_words
        ]
        text = f"{title} {snippet}".lower()
        overlap = sum(1 for t in terms if t in text)

        host = urlparse(url).netloc.lower()
        trusted_boost = 0.0
        trusted_domains = {
            "reuters.com": 2.5,
            "bloomberg.com": 2.5,
            "ft.com": 2.0,
            "wsj.com": 2.0,
            "marketwatch.com": 1.5,
            "cnbc.com": 1.5,
            "investing.com": 1.5,
            "oilprice.com": 1.0,
            "tradingeconomics.com": 1.5,
            "eia.gov": 2.0,
            "iea.org": 2.0,
            "norges-bank.no": 2.0,
            "ssb.no": 2.0,
        }
        for d, b in trusted_domains.items():
            if d in host:
                trusted_boost = b
                break

        # Penalize tabloids / obvious low-relevance sources for finance market facts
        penalty = 0.0
        if any(x in host for x in ["iltalehti", "seiska", "clickbait"]):
            penalty = 2.0

        return overlap + trusted_boost - penalty

    def _search_web(self, question: str, max_results: int = 5) -> list[dict[str, str]]:
        """Search the public web for supplementary context and rerank for relevance."""
        try:
            from ddgs import DDGS
        except Exception:
            try:
                # Backward-compatible fallback if old package is still installed
                from duckduckgo_search import DDGS
            except Exception:
                logger.warning("No DDGS-compatible package installed; web search disabled")
                return []

        variants = self._web_query_variants(question)
        if not variants:
            return []

        candidates: list[dict[str, str]] = []
        seen_urls: set[str] = set()
        seen_domains: dict[str, int] = {}  # domain -> hit count (cap at 2 per domain)
        try:
            with DDGS() as ddgs:
                for q in variants:
                    results = ddgs.text(
                        q,
                        region="wt-wt",
                        safesearch="moderate",
                        max_results=max_results * 4,
                    )
                    for r in results:
                        title = str(r.get("title", "")).strip()
                        url = str(r.get("href", "")).strip()
                        snippet = str(r.get("body", "")).strip()
                        if not title or not url:
                            continue
                        if url in seen_urls:
                            continue
                        # Cap at 2 results per domain to ensure source diversity
                        domain = urlparse(url).netloc.lower()
                        if seen_domains.get(domain, 0) >= 2:
                            continue
                        seen_urls.add(url)
                        seen_domains[domain] = seen_domains.get(domain, 0) + 1
                        score = self._score_web_hit(question, title, snippet, url)
                        candidates.append(
                            {
                                "title": title,
                                "url": url,
                                "snippet": snippet,
                                "score": str(score),
                            }
                        )
        except Exception as exc:
            logger.warning("Web search failed: %s", exc)
            return []

        candidates.sort(key=lambda x: float(x.get("score", "0")), reverse=True)
        return [
            {"title": c["title"], "url": c["url"], "snippet": c["snippet"]}
            for c in candidates[:max_results]
        ]

    def _build_web_context(self, hits: list[dict[str, str]]) -> str:
        if not hits:
            return ""

        fetched_at = datetime.now(timezone.utc).isoformat()
        parts: list[str] = []
        for i, hit in enumerate(hits, start=1):
            parts.append(
                f"[WEB {i}] {hit.get('title', '')}\n"
                f"URL: {hit.get('url', '')}\n"
                f"Utdrag: {hit.get('snippet', '')}"
            )
        return (
            f"WEB-KILDER (nyere kontekst utenfor podcast-arkivet, hentet {fetched_at}):\n\n"
            + "\n\n".join(parts)
        )

    def _render_web_citations(self, web_hits: list[dict[str, str]]) -> str:
        if not web_hits:
            return ""
        lines = ["### Kilder (web)"]
        for i, hit in enumerate(web_hits, start=1):
            lines.append(f"- [WEB {i}] {hit.get('title', '')} — {hit.get('url', '')}")
        return "\n" + "\n".join(lines)

    def _has_web_citations_section(self, text: str) -> bool:
        # Accept any markdown heading level (##/###/etc.) for this section.
        return bool(re.search(r"(?im)^\s*#{1,6}\s*Kilder\s*\(web\)\s*$", text or ""))

    # -- Full-transcript retrieval -----------------------------------------

    _tokenizer = tiktoken.get_encoding("cl100k_base")
    MAX_TRANSCRIPT_TOKENS = 30_000   # budget for the one full transcript
    MAX_FULL_EPISODES = 1            # depth on best match only

    def _find_transcript_file(self, episode_number: int) -> Path | None:
        """Find the .md transcript file for an episode number."""
        transcript_dir = Path(settings.transcript_dir)
        prefix = f"{episode_number:03d}_"
        for md_file in transcript_dir.glob(f"{prefix}*.md"):
            return md_file
        return None

    def _read_transcript_body(self, path: Path) -> str:
        """Read an .md file and return the body (strip YAML frontmatter)."""
        text = path.read_text(encoding="utf-8-sig")  # utf-8-sig strips BOM
        if text.startswith("---"):
            end = text.find("---", 3)
            if end != -1:
                return text[end + 3:].strip()
        return text.strip()

    def _count_tokens(self, text: str) -> int:
        return len(self._tokenizer.encode(text))

    def _build_context_with_full_transcripts(
        self, chunks: list[tuple[str, dict, float]]
    ) -> str:
        """Build LLM context: chunks from all episodes (breadth) + 1 full transcript (depth)."""

        # Rank episodes by best chunk similarity
        best_per_episode: dict[int, tuple[str, dict, float]] = {}
        for doc, meta, dist in chunks:
            ep = meta.get("episode_number")
            if ep is None:
                continue
            if ep not in best_per_episode or dist < best_per_episode[ep][2]:
                best_per_episode[ep] = (doc, meta, dist)

        ranked_episodes = sorted(best_per_episode.items(), key=lambda x: x[1][2])

        # Load full transcript for the single best-matching episode
        full_part: str | None = None
        full_ep: int | None = None

        for ep_num, (_, meta, dist) in ranked_episodes[:self.MAX_FULL_EPISODES]:
            path = self._find_transcript_file(ep_num)
            if path is None:
                continue
            body = self._read_transcript_body(path)
            body_tokens = self._count_tokens(body)
            if body_tokens > self.MAX_TRANSCRIPT_TOKENS:
                body = body[:self.MAX_TRANSCRIPT_TOKENS * 4]  # rough char trim
            full_ep = ep_num
            title = meta.get("title", "?")
            date = meta.get("date", "?")
            similarity = 1 - dist
            full_part = (
                f"[FULL TRANSKRIPSJON — Episode {ep_num}: {title} ({date})] "
                f"(relevans: {similarity:.2f})\n{body}"
            )
            logger.info(
                "Full transcript loaded: episode %d, ~%d tokens",
                ep_num, body_tokens,
            )

        # Chunk snippets from ALL episodes (including the full one — chunks
        # give the LLM quick-reference anchors even when it has the full text)
        snippet_parts: list[str] = []
        for doc, meta, dist in chunks:
            ep = meta.get("episode_number")
            similarity = 1 - dist
            title = meta.get("title", "?")
            date = meta.get("date", "?")
            snippet_parts.append(
                f"[Episode {ep}: {title} ({date})] (relevans: {similarity:.2f})\n{doc}"
            )

        logger.info(
            "Context: 1 full transcript (ep %s) + %d chunk snippets across %d episodes",
            full_ep, len(snippet_parts), len(best_per_episode),
        )

        parts = []
        if snippet_parts:
            parts.append("RELEVANTE UTDRAG FRA PODCAST-ARKIVET (flere episoder):\n\n"
                         + "\n---\n".join(snippet_parts))
        if full_part:
            parts.append("FULLSTENDIG TRANSKRIPSJON (mest relevante episode):\n\n"
                         + full_part)

        return "\n\n" + "\n\n".join(parts)

    @staticmethod
    def _build_instructions_block(instructions: dict) -> str:
        """Convert saved user presets + free text into a Norwegian instruction block."""
        tone_map = {
            "kortfattet": "Svar kortfattet og presist — unngå unødvendige utdypninger.",
            "detaljert": "Gi detaljerte svar med eksempler og kontekst.",
            "akademisk": "Bruk akademisk og analytisk stil med presise formuleringer.",
        }
        language_map = {
            "engelsk": "Svar alltid på engelsk.",
            "begge": "Du kan svare på norsk og engelsk — velg det som passer best.",
        }
        focus_map = {
            "makro": "Fokuser på makroøkonomiske perspektiver.",
            "renter": "Vektlegg renter, sentralbanker og inflasjonsdynamikk.",
            "aksjer": "Fokuser på aksjer, sektorer og verdsettelse.",
            "esg": "Legg vekt på bærekraft, ESG og ansvarlig kapitalforvaltning.",
        }
        lines: list[str] = []
        tone = (instructions.get("preset_tone") or "").lower()
        lang = (instructions.get("preset_language") or "").lower()
        focus = (instructions.get("preset_focus") or "").lower()
        free = (instructions.get("free_text") or "").strip()

        if tone in tone_map:
            lines.append(f"- {tone_map[tone]}")
        if lang in language_map:
            lines.append(f"- {language_map[lang]}")
        if focus in focus_map:
            lines.append(f"- {focus_map[focus]}")
        if free:
            lines.append(f"- {free}")

        if not lines:
            return ""
        return "BRUKERINSTRUKSJONER (følg disse for dette svaret):\n" + "\n".join(lines)

    @staticmethod
    def _build_corrections_block(corrections: list[dict]) -> str:
        """Format up to 5 personal thumbs-down corrections as few-shot examples."""
        if not corrections:
            return ""
        lines = ["KORREKSJONER FRA BRUKER (ta hensyn til disse):"]
        for i, c in enumerate(corrections[:5], start=1):
            q = (c.get("question") or "")[:120]
            correction = (c.get("correction") or "")[:200]
            lines.append(f"[{i}] Spørsmål: \"{q}\" — Korreksjon: \"{correction}\"")
        return "\n".join(lines)

    @staticmethod
    def _build_global_memory_block(patterns: list[dict]) -> str:
        """Format up to 3 global consensus patterns for prompt injection."""
        if not patterns:
            return ""
        lines = ["SYSTEMLÆRING (basert på tilbakemeldinger fra alle brukere):"]
        for p in patterns[:3]:
            pattern_text = (p.get("pattern") or "")[:200]
            lines.append(f"- {pattern_text}")
        return "\n".join(lines)

    def _build_user_prompt(
        self,
        question: str,
        context: str,
        web_context: str = "",
        instructions: dict | None = None,
        corrections: list[dict] | None = None,
        global_memory: list[dict] | None = None,
    ) -> str:
        parts: list[str] = []

        # 1. Global system learning (cross-user patterns)
        if global_memory:
            block = self._build_global_memory_block(global_memory)
            if block:
                parts.append(block)

        # 2. Personal instructions (presets + free text)
        if instructions:
            block = self._build_instructions_block(instructions)
            if block:
                parts.append(block)

        # 3. Personal corrections (few-shot examples)
        if corrections:
            block = self._build_corrections_block(corrections)
            if block:
                parts.append(block)

        # 4. The question + podcast context
        parts.append(f"SPØRSMÅL: {question}\n\nRELEVANT KONTEKST FRA PODCAST-ARKIVET:\n{context}")

        # 5. Web sources + instructions (if any)
        if web_context:
            n_sources = web_context.count("[WEB ")
            parts.append(
                f"{web_context}\n\n"
                f"⚠️ VIKTIG — DU HAR {n_sources} AKTIVE WEB-KILDE{'R' if n_sources != 1 else ''} OVER:\n"
                f"- Dette er ekte, fersk data hentet nå. Bruk dem.\n"
                f"- Del inn svaret i: \"### Fra podcast-arkivet\" og \"### Fra web-kilder\" — to adskilte seksjoner.\n"
                f"- PÅKREVD: Sitér med [WEB 1], [WEB 2] osv. ved HVERT faktapunkt fra nettet.\n"
                f"- Ikke si «jeg kan ikke sjekke nettet» eller «per min kunnskap» — du HAR kildene.\n"
                f"- VIKTIG: Ikke trekk slutninger på tvers av kilder som handler om ULIKE temaer. Referer til dem separat og nøytralt.\n"
                f"- Ikke fremstill urelaterte fakta som «interessante spenninger», «paradokser» eller «intern konflikt» med mindre det er åpenbart og direkte uttalt i kildene.\n"
                f"- AVSLUTT alltid med en \"### Kilder (web)\"-seksjon som lister URL-er."
            )

        return "\n\n".join(parts)

    def _generate_answer_from_chunks(
        self, question: str, context: str, chunks: list[tuple[str, dict, float]],
        model: str | None = None,
        web_context: str = "",
        web_hits: list[dict[str, str]] | None = None,
        instructions: dict | None = None,
        corrections: list[dict] | None = None,
        global_memory: list[dict] | None = None,
    ) -> dict:
        user_prompt = self._build_user_prompt(
            question, context, web_context,
            instructions=instructions,
            corrections=corrections,
            global_memory=global_memory,
        )
        answer_text = self._call_llm(SYSTEM_PROMPT, user_prompt, model=model)
        if web_hits:
            citations_block = self._render_web_citations(web_hits)
            if citations_block and not self._has_web_citations_section(answer_text):
                answer_text = answer_text.rstrip() + "\n\n" + citations_block.lstrip()
        sources, confidence = self._build_sources(chunks)
        return {"answer": answer_text, "sources": sources, "confidence": confidence}

    def prepare_streaming(
        self, question: str, context: str, chunks: list[tuple[str, dict, float]],
        model: str | None = None,
        web_context: str = "",
        web_hits: list[dict[str, str]] | None = None,
        instructions: dict | None = None,
        corrections: list[dict] | None = None,
        global_memory: list[dict] | None = None,
    ) -> Generator[str, None, None]:
        """Return an SSE event generator: sources first, then token deltas, then done."""
        sources, confidence = self._build_sources(chunks)

        # First event: sources metadata (so frontend can render cards immediately)
        yield f"event: sources\ndata: {json.dumps({'sources': sources, 'confidence': confidence}, ensure_ascii=False)}\n\n"

        # Stream LLM answer tokens
        user_prompt = self._build_user_prompt(
            question, context, web_context,
            instructions=instructions,
            corrections=corrections,
            global_memory=global_memory,
        )
        assembled = ""
        for delta in self._call_llm_stream(SYSTEM_PROMPT, user_prompt, model=model):
            assembled += delta
            yield f"event: token\ndata: {json.dumps({'text': delta}, ensure_ascii=False)}\n\n"

        if web_hits:
            citations_block = self._render_web_citations(web_hits)
            if citations_block and not self._has_web_citations_section(assembled):
                citations_delta = "\n\n" + citations_block
                yield f"event: token\ndata: {json.dumps({'text': citations_delta}, ensure_ascii=False)}\n\n"

        # Final event
        yield "event: done\ndata: {}\n\n"
