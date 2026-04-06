from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LLM API (OpenAI-compatible — Radical Gateway by default)
    llm_api_key: str = ""
    llm_url: str = "http://localhost:11434/v1"
    llm_model: str = "eu-sonnet-4-6"

    # Embedding model (local sentence-transformers, no API key needed)
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    # Whisper
    whisper_model: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_initial_prompt: str = (
        "Utbytte podcast, programleder Marius Brun Haugen, DNB, Oslo Børs, OSEBX, OBX, "
        "Equinor, Hydro, Norsk Hydro, Yara, Telenor, Orkla, Mowi, Salmar, Aker, Aker BP, "
        "Aker Solutions, Kongsberg Gruppen, Schibsted, Storebrand, DNB Bank, SpareBank, "
        "Gjensidige, Tomra, Subsea 7, TGS, PGS, Vår Energi, Borr Drilling, Flex LNG, "
        "Frontline, Golden Ocean, Höegh Autoliners, Nordic Semiconductor, Elkem, REC Silicon, "
        "NEL, Hexagon Composites, Odfjell, Wallenius Wilhelmsen, Nicolai Tangen, Oljefondet, "
        "Statens pensjonsfond utland, SPU, Norges Bank Investment Management, NBIM, "
        "Folketrygdfondet, Finanstilsynet, Norges Bank, utbytte, direkteavkastning, "
        "P/E, P/B, EV/EBITDA, EBITDA, ROE, ROCE, capex, bull, bear, volatilitet, "
        "rentebane, styringsrente, inflasjon, KPI, KPI-JAE, kronekurs, NOK, "
        "high yield, investment grade, obligasjon, statsbudsjettet, handlingsregelen, "
        "emisjon, IPO, fusjon, oppkjøp, M&A, Euronext, Nasdaq, Federal Reserve, ECB"
    )

    # Storage paths (relative to backend/)
    audio_dir: str = "storage/audio"
    transcript_dir: str = "storage/transcripts"
    chroma_persist_dir: str = "storage/chromadb"

    # RSS
    rss_feed_url: str = "https://feeds.acast.com/public/shows/utbytte"

    # API server
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    frontend_url: str = "http://localhost:3000"

    # Pipeline
    max_concurrent_episodes: int = 8
    chunk_size_tokens: int = 750
    chunk_overlap_tokens: int = 100

    model_config = {
        "env_file": ["../.env", ".env"],
        "env_file_encoding": "utf-8",
    }

    def ensure_dirs(self) -> None:
        for d in [self.audio_dir, self.transcript_dir, self.chroma_persist_dir]:
            Path(d).mkdir(parents=True, exist_ok=True)


settings = Settings()
