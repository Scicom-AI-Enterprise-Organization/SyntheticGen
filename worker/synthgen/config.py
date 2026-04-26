"""Environment configuration shared by API and worker processes."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    database_url: str = "postgresql://postgres:postgres@localhost:5434/enterprise"
    app_encryption_key: str = ""
    synthgen_internal_token: str = "local-dev-internal-token"

    api_host: str = "0.0.0.0"
    api_port: int = 8000

    worker_poll_interval_seconds: float = 2.0
    worker_concurrency: int = 4
    worker_lock_id: int = 924715  # arbitrary advisory-lock namespace

    exports_dir: str = "./storage/exports"

    request_timeout_seconds: float = 120.0

    @property
    def asyncpg_dsn(self) -> str:
        # Strip Prisma's `?schema=public` query param — asyncpg/psycopg dislike it.
        url = self.database_url
        if "?schema=" in url:
            url = url.split("?schema=", 1)[0]
        return url

    @property
    def exports_path(self) -> Path:
        return Path(self.exports_dir).resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
