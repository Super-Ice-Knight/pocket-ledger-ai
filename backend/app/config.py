from functools import lru_cache
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_path: str = Field(default="data/pocket_ledger.db", alias="POCKET_LEDGER_DB_PATH")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_COMPATIBLE_API_KEY")
    openai_base_url: str = Field(default="https://api.openai.com/v1", alias="OPENAI_COMPATIBLE_BASE_URL")
    openai_model: str = Field(default="your-model-name", alias="OPENAI_COMPATIBLE_MODEL")
    backup_openai_api_key: str | None = Field(default=None, alias="BACKUP_OPENAI_COMPATIBLE_API_KEY")
    backup_openai_base_url: str = Field(default="", alias="BACKUP_OPENAI_COMPATIBLE_BASE_URL")
    backup_openai_model: str = Field(default="", alias="BACKUP_OPENAI_COMPATIBLE_MODEL")
    ai_request_timeout_seconds: int = Field(default=45, alias="AI_REQUEST_TIMEOUT_SECONDS")
    cors_allowed_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        alias="CORS_ALLOWED_ORIGINS",
    )

    @property
    def resolved_database_path(self) -> Path:
        path = Path(self.database_path)
        if not path.is_absolute():
            return Path.cwd() / path
        return path

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
