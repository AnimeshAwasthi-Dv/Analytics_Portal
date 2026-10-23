
import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv(
    dotenv_path=Path(__file__).resolve().parents[1] / ".env",
    encoding="utf-8-sig",
    override=False,
)

db_user = os.getenv("DATABASE_USER")
db_pass = os.getenv("DATABASE_PASSWORD")
db_host = os.getenv("DATABASE_HOST", "localhost")
db_port = os.getenv("DATABASE_PORT", "5432")
db_name = os.getenv("DATABASE_NAME")
database_url = os.getenv("DATABASE_URL")

if database_url:
    DATABASE_URL = database_url
elif db_user and db_pass and db_name:
    DATABASE_URL = (
        f"postgresql+psycopg://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"
    )
else:
    raise RuntimeError(
        "PostgreSQL configuration is required: set DATABASE_URL or "
        "DATABASE_USER, DATABASE_PASSWORD, and DATABASE_NAME"
    )

if DATABASE_URL.startswith("postgresql+psycopg2://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgresql+psycopg2://", "postgresql+psycopg://", 1
    )

if not DATABASE_URL.startswith(("postgresql://", "postgresql+psycopg://")):
    raise RuntimeError("Only PostgreSQL DATABASE_URL values are supported")

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
