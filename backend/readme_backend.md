# Central Sync Portal — Installation Guide

This guide starts from a fresh clone and covers **Python setup → virtual environment → dependencies → `.env` → Alembic → database migration → admin/API-key seeding → running the FastAPI server → testing the API**.

## 1. Clone the repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd CDS/backend
```

If you already cloned the repository:

```bash
cd D:\CDS\backend
```

---

# 2. Check Python

The project uses Python.

Check:

```bash
python --version
```

Recommended:

```text
Python 3.12.x
```

If `python` doesn't work on Windows, try:

```bash
py --version
```

---

# 3. Create a virtual environment

From the `backend` directory:

```bash
python -m venv venv
```

Activate it in **Git Bash**:

```bash
source venv/Scripts/activate
```

Or in **PowerShell**:

```powershell
.\venv\Scripts\Activate.ps1
```

You should see:

```text
(venv)
```

at the beginning of your terminal.

---

# 4. Upgrade pip

```bash
python -m pip install --upgrade pip
```

---

# 5. Install project dependencies

The repository contains:

```text
requirements.txt
```

with:

```txt
fastapi
uvicorn[standard]
sqlalchemy
psycopg[binary]
python-dotenv
python-jose[cryptography]
pwdlib[argon2]
pydantic[email]
alembic==1.20.0
```

Install everything:

```bash
pip install -r requirements.txt
```

Verify Alembic:

```bash
python -m alembic --version
```

Expected:

```text
alembic 1.20.0
```

---

# 6. Configure `.env`

Create:

```text
D:\CDS\backend\.env
```

Example:

```env
DATABASE_URL=sqlite:///./central_sync.db

JWT_SECRET=central_sync_portal_jwt_secret_key_9876543210
JWT_ALGORITHM=HS256
JWT_EXPIRATION=60

INITIAL_ADMIN_EMAIL=admin@local.com
INITIAL_ADMIN_PASSWORD=adminpassword123

MARENGO_API_KEY=your_marengo_api_key_here
```

### Important

Do **not** commit `.env` to Git.

Your `.gitignore` should contain:

```gitignore
.env
venv/
__pycache__/
*.pyc
*.db
```

---

# 7. Check the project structure

Your backend should look approximately like:

```text
backend/
│
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── auth_api.py
│   └── routes.py
│
├── migrations/
│   ├── versions/
│   ├── env.py
│   └── script.py.mako
│
├── alembic.ini
├── seed.py
├── requirements.txt
├── .env
└── .gitignore
```

---

# 8. Configure Alembic

Alembic needs to know about your SQLAlchemy models.

The important part of `migrations/env.py` should load your `.env` and use your application's `Base`.

For example:

```python
from logging.config import fileConfig
import os
import sys

from sqlalchemy import engine_from_config, pool
from alembic import context
from dotenv import load_dotenv

sys.path.insert(
    0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

load_dotenv()

from app.database import Base
from app import models

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

database_url = os.getenv("DATABASE_URL")

if not database_url:
    raise ValueError("DATABASE_URL is missing from .env")

config.set_main_option(
    "sqlalchemy.url",
    database_url
)

target_metadata = Base.metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")

    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"}
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(
            config.config_ini_section,
            {}
        ),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

---

# 9. Create the migration

If this is a **fresh installation** and migrations have not already been created in the repository:

```bash
python -m alembic revision --autogenerate -m "initial database schema"
```

This creates a migration under:

```text
migrations/versions/
```

Check:

```bash
python -m alembic history
```

---

# 10. Apply the database migration

Run:

```bash
python -m alembic upgrade head
```

Expected output will look similar to:

```text
INFO  [alembic.runtime.migration] Running upgrade ...
```

This creates the database tables.

For your current project, tables include:

```text
users
api_keys
database_configs
source_instances
sync_records
sync_logs
```

---

# 11. Verify the database tables

Run:

```bash
python -c "from sqlalchemy import inspect; from app.database import engine; print(inspect(engine).get_table_names())"
```

You should see something similar to:

```text
['alembic_version', 'api_keys', 'database_configs', 'source_instances', 'sync_logs', 'sync_records', 'users']
```

---

# 12. Seed the database

Your seed script creates the initial admin account and Marengo API key.

Run:

```bash
python seed.py
```

Expected output:

```text
Admin account already exists: admin@local.com
Marengo API key created successfully!
```

If it is a completely fresh database, you may instead see something indicating that the admin account was created.

---

# 13. Verify the API key

Run:

```bash
python -c "from app.database import SessionLocal; from app.models import ApiKey; db=SessionLocal(); print([(x.id,x.key_name,x.api_key[:4]+'****') for x in db.query(ApiKey).all()]); db.close()"
```

Expected:

```text
[(1, 'Marengo', 'sk_l****')]
```

This confirms the Marengo API key exists.

**Do not print the complete API key in a shared terminal/screenshot.**

---

# 14. Start FastAPI

Run:

```bash
uvicorn app.main:app --reload
```

Expected:

```text
Uvicorn running on http://127.0.0.1:8000
```

Your API is now running.

---

# 15. Check the health endpoint

Open:

```text
http://127.0.0.1:8000/health
```

Expected:

```json
{
    "status": "healthy"
}
```

You can also open Swagger:

```text
http://127.0.0.1:8000/docs
```

---

# 16. Test the Sync API using Postman

### Method

```text
POST
```

### URL

```text
http://127.0.0.1:8000/api/v1/sync
```

### Authorization

Postman:

```text
Authorization
    Type: Bearer Token
    Token: <your Marengo API key>
```

### Body

Select:

```text
Body → raw → JSON
```

Use:

```json
{
    "modality": "XR",
    "processing_created_at": "2026-10-03T10:20:00",
    "processing_completed_at": "2026-10-03T10:24:00",
    "credits_used": 4
}
```

Click **Send**.

Expected:

```json
{
    "success": true,
    "message": "Data synchronized successfully",
    "record_id": 1
}
```

---

# 17. Verify the data was saved

Check the number of records:

```bash
python -c "from app.database import SessionLocal; from app.models import SyncRecord; db=SessionLocal(); print(db.query(SyncRecord).count()); db.close()"
```

For example:

```text
1
```

means one `SyncRecord` exists.

To see the actual records:

```bash
python -c "from app.database import SessionLocal; from app.models import SyncRecord; db=SessionLocal(); print([(x.id,x.instance_code,x.modality,x.credits_used,x.sync_status) for x in db.query(SyncRecord).all()]); db.close()"
```

Example:

```text
[(1, 'Marengo', 'XR', 4, 'SYNCED')]
```

---

# 18. Verify the sync logs

```bash
python -c "from app.database import SessionLocal; from app.models import SyncLog; db=SessionLocal(); print([(x.id,x.instance_code,x.event_type,x.status,x.message) for x in db.query(SyncLog).all()]); db.close()"
```

Expected:

```text
[(1, 'Marengo', 'SYNC', 'SUCCESS', 'Data received successfully')]
```

---

# 19. Test invalid API key

In Postman, change the Bearer token to:

```text
wrong_key
```

Send the request again.

Expected:

```text
401 Unauthorized
```

with:

```json
{
    "detail": "Invalid API key"
}
```

This confirms that API authentication is working.

---

# 20. Clear test data

If you want to remove the test synchronization records:

```bash
python -c "from app.database import SessionLocal; from app.models import SyncRecord, SyncLog; db=SessionLocal(); db.query(SyncRecord).delete(); db.query(SyncLog).delete(); db.commit(); db.close(); print('sync_records and sync_logs cleared')"
```

This **does not remove** your admin account or API key.

---

# Complete installation flow

For a developer setting up the project from scratch, the main sequence is:

```text
Clone repository
       ↓
cd backend
       ↓
Create venv
       ↓
Activate venv
       ↓
pip install -r requirements.txt
       ↓
Create .env
       ↓
Configure DATABASE_URL
       ↓
Alembic installed
       ↓
alembic upgrade head
       ↓
Database tables created
       ↓
python seed.py
       ↓
Admin + Marengo API key created
       ↓
uvicorn app.main:app --reload
       ↓
Postman
       ↓
POST /api/v1/sync
       ↓
Bearer API key authentication
       ↓
SyncRecord + SyncLog
       ↓
Database
```

### Quick setup commands

For someone who already has the repository and just wants the commands:

```bash
cd D:\CDS\backend
```

```bash
python -m venv venv
```

```bash
source venv/Scripts/activate
```

```bash
python -m pip install --upgrade pip
```

```bash
pip install -r requirements.txt
```

```bash
python -m alembic upgrade head
```

```bash
python seed.py
```

```bash
uvicorn app.main:app --reload
```

Then test:

```text
http://127.0.0.1:8000/docs
```

**One important distinction:** `alembic revision --autogenerate` is normally used by the **developer when changing the database schema**. A new developer setting up the project from Git should generally only run:

```bash
python -m alembic upgrade head
```

because the migration files should already be committed to Git.
