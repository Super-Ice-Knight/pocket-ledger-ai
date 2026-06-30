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

    @property
    def resolved_database_path(self) -> Path:
        path = Path(self.database_path)
        if not path.is_absolute():
            return Path.cwd() / path
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()
