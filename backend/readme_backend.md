from pathlib import Path

readme = r"""# Central Data Synchronization Portal

A centralized portal for receiving synchronization data from multiple EC2/database instances, storing it in PostgreSQL, and displaying synchronization and QC information through a React dashboard.

## Architecture

```text
EC2 Sync Scripts / Database Instances
                |
                |  API Key authenticated
                v
        FastAPI Backend
                |
                v
          PostgreSQL
                |
                v
        React Dashboard
```

## Tech Stack

### Backend
- Python
- FastAPI
- SQLAlchemy
- Alembic
- PostgreSQL
- JWT authentication
- HTTP-only cookies for authentication

### Frontend
- React
- TypeScript
- Vite
- React Router
- Lucide React

---

# Project Structure

```text
CDS/
│
├── backend/
│   ├── app/
│   │   ├── auth.py
│   │   ├── database.py
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── routes.py
│   │   └── seed.py
│   │
│   ├── alembic/
│   │   ├── versions/
│   │   │   └── ed608f36b583_initial_postgres_schema.py
│   │   └── ...
│   │
│   ├── alembic.ini
│   ├── requirements.txt
│   ├── .env
│   └── ...
│
└── frontend/
    ├── src/
    ├── package.json
    └── ...
```

---

# Prerequisites

Install the following before starting:

- Python 3.10+
- Node.js and npm
- PostgreSQL 18
- Git

For Windows, PostgreSQL can be downloaded from:

https://www.postgresql.org/download/windows/

The PostgreSQL Windows installer can also install pgAdmin 4.

---

# 1. Clone the Repository

```bash
git clone <REPOSITORY_URL>
cd CDS
```

---

# 2. PostgreSQL Setup

PostgreSQL is required for the backend.

## Create the Database User

Open `psql` or pgAdmin and connect as a PostgreSQL administrator.

Run:

```sql
CREATE USER central_sync WITH PASSWORD 'YOUR_DATABASE_PASSWORD';
```

Create the database:

```sql
CREATE DATABASE central_sync OWNER central_sync;
```

Connect to the newly created `central_sync` database and run:

```sql
GRANT ALL ON SCHEMA public TO central_sync;
```

You can verify the connection with:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U central_sync -h localhost -d central_sync
```

Enter the password created above when prompted.

> If PostgreSQL was installed in a different location, update the `psql.exe` path accordingly.

---

# 3. Backend Setup

Open a terminal inside the backend directory:

```powershell
cd backend
```

Create a Python virtual environment:

```powershell
python -m venv .venv
```

Activate it:

```powershell
.\.venv\Scripts\Activate.ps1
```

Install dependencies:

```powershell
pip install -r requirements.txt
```

---

# 4. Configure Environment Variables

Create a file named:

```text
backend/.env
```

Use the following structure:

```env
DATABASE_URL=postgresql+psycopg2://central_sync:YOUR_DATABASE_PASSWORD@localhost:5432/central_sync

JWT_SECRET=CHANGE_THIS_TO_A_RANDOM_SECRET
JWT_ALGORITHM=HS256
JWT_EXPIRATION=60

INITIAL_ADMIN_EMAIL=admin@local.com
INITIAL_ADMIN_PASSWORD=CHANGE_THIS_PASSWORD

MARENGO_API_KEY=CHANGE_THIS_API_KEY
PACS_API_KEY=CHANGE_THIS_API_KEY

PORTAL_API_KEY_3=
PORTAL_API_KEY_4=
PORTAL_API_KEY_5=
```

### Important

Do **not** commit `.env` to Git.

The `.env` file contains passwords, JWT secrets, and API keys.

A safe `.env.example` should be committed instead:

```env
DATABASE_URL=postgresql+psycopg2://central_sync:YOUR_DATABASE_PASSWORD@localhost:5432/central_sync

JWT_SECRET=CHANGE_ME
JWT_ALGORITHM=HS256
JWT_EXPIRATION=60

INITIAL_ADMIN_EMAIL=admin@local.com
INITIAL_ADMIN_PASSWORD=CHANGE_ME

MARENGO_API_KEY=CHANGE_ME
PACS_API_KEY=CHANGE_ME

PORTAL_API_KEY_3=
PORTAL_API_KEY_4=
PORTAL_API_KEY_5=
```

---

# 5. Run Database Migrations

The project uses Alembic to create and manage the PostgreSQL schema.

From the `backend` directory:

```powershell
alembic upgrade head
```

This creates the required tables.

Current schema includes:

```text
users
api_keys
sync_records
sync_logs
alembic_version
```

You should not need to manually create these application tables.

---

# 6. Create the Initial Admin User and API Keys

Run:

```powershell
python -m app.seed
```

The seed script:

- Creates the initial admin user.
- Hashes the admin password before storing it.
- Creates configured API-key records.
- Skips API keys that are not configured in `.env`.
- Does not recreate records that already exist.

---

# 7. Start the Backend

From:

```text
CDS/backend
```

run:

```powershell
uvicorn app.main:app --reload
```

The backend will normally be available at:

```text
http://127.0.0.1:8000
```

Health check:

```text
http://127.0.0.1:8000/health
```

Expected response:

```json
{
  "status": "healthy"
}
```

Swagger API documentation:

```text
http://127.0.0.1:8000/docs
```

---

# 8. Frontend Setup

Open a second terminal.

Move to the frontend directory:

```powershell
cd frontend
```

Install dependencies:

```powershell
npm install
```

Start the development server:

```powershell
npm run dev
```

Vite will display the local frontend URL in the terminal, normally:

```text
http://localhost:5173
```

---

# 9. Authentication

The portal uses JWT authentication.

The JWT is stored in a:

```text
Secure HTTP-only cookie
```

The token is not stored in:

```text
localStorage
sessionStorage
```

Authentication endpoints:

```text
POST /auth/login
POST /auth/logout
GET  /auth/me
```

The frontend should use the login endpoint and allow the browser to manage the HTTP-only authentication cookie.

---

# 10. Sync API

EC2 sync scripts send synchronization data to:

```text
POST /api/v1/sync
```

The endpoint uses API-key authentication.

The API key must match one of the configured keys in the `api_keys` table.

The API identifies the sending instance from the matching API-key configuration.

For example:

```text
EC2 Instance
     |
     | Authorization: Bearer <API_KEY>
     v
POST /api/v1/sync
     |
     v
FastAPI
     |
     v
PostgreSQL
```

The API stores synchronization records and creates a synchronization log.

---

# 11. Dashboard API

The dashboard retrieves centralized synchronization information through:

```text
GET /api/v1/dashboard
```

The endpoint requires authentication.

The dashboard can display information such as:

- Total instances
- Online instances
- Records synchronized
- Pending records
- Synchronization activity
- Instance-specific synchronization information

---

# 12. Database Management with pgAdmin

pgAdmin can be used to inspect the PostgreSQL database.

Connect using:

```text
Host: localhost
Port: 5432
Database: central_sync
Username: central_sync
Password: <your database password>
```

After connecting:

```text
Servers
└── PostgreSQL
    └── Databases
        └── central_sync
            └── Schemas
                └── public
                    └── Tables
                        ├── api_keys
                        ├── sync_logs
                        ├── sync_records
                        └── users
```

For security, avoid displaying API-key values unnecessarily.

A safer query for inspecting configured keys is:

```sql
SELECT
    id,
    key_name,
    length(api_key) AS key_length,
    left(api_key, 6) AS key_prefix
FROM api_keys;
```

---

# 13. Useful Development Commands

## Check Alembic Version

```powershell
alembic current
```

## Check Migration Status

```powershell
alembic check
```

## Apply Migrations

```powershell
alembic upgrade head
```

## Show Migration History

```powershell
alembic history
```

## Start Backend

```powershell
uvicorn app.main:app --reload
```

## Start Frontend

```powershell
npm run dev
```

---

# 14. Fresh Setup

For a new developer setting up the project from scratch, the normal sequence is:

```text
1. Install Git
        ↓
2. Install Python
        ↓
3. Install Node.js
        ↓
4. Install PostgreSQL
        ↓
5. Clone repository
        ↓
6. Create PostgreSQL user/database
        ↓
7. Create backend/.env
        ↓
8. Create Python virtual environment
        ↓
9. pip install -r requirements.txt
        ↓
10. alembic upgrade head
        ↓
11. python -m app.seed
        ↓
12. Start FastAPI
        ↓
13. npm install
        ↓
14. Start React frontend
```

---

# 15. Git and Environment Files

The following files should **not** be committed:

```text
.env
.venv/
venv/
__pycache__/
*.pyc
central_sync.db
```

Recommended `.gitignore` entries:

```gitignore
# Environment
.env
.env.*

# Python
.venv/
venv/
__pycache__/
*.pyc

# Local database
central_sync.db

# Node
node_modules/

# Build output
dist/
build/
```

If `.env.example` is used, explicitly allow it:

```gitignore
.env
.env.*
!.env.example
```

---

# 16. Important Security Notes

Never commit:

- PostgreSQL passwords
- JWT secrets
- API keys
- Production credentials
- Personal access tokens

Use different credentials for:

```text
Development
Testing
Production
```

If an API key or password is accidentally committed or exposed, rotate it immediately.

---

# 17. Database Migration Policy

Alembic is the source of truth for the database schema.

When changing SQLAlchemy models:

1. Update the model.
2. Generate an Alembic migration.
3. Review the generated migration.
4. Commit the migration file.
5. Run:

```powershell
alembic upgrade head
```

Do not rely on:

```python
Base.metadata.create_all(bind=engine)
```

for production schema management.

---

# 18. Troubleshooting

## PostgreSQL connection failed

Check that PostgreSQL is running.

On Windows:

```powershell
Get-Service postgresql-x64-18
```

Start it if necessary:

```powershell
Start-Service postgresql-x64-18
```

---

## Database authentication failed

Verify:

- PostgreSQL is running.
- Database name is correct.
- Username is `central_sync`.
- Password matches the `.env`.
- Port is `5432`.
- `DATABASE_URL` is correct.

---

## Alembic cannot connect

Check:

```env
DATABASE_URL=postgresql+psycopg2://central_sync:YOUR_DATABASE_PASSWORD@localhost:5432/central_sync
```

Then run:

```powershell
alembic current
```

---

## API returns `Not authenticated`

For protected endpoints, first log in through:

```text
POST /auth/login
```

The authentication cookie must then be sent with subsequent requests.

---

## API returns `Invalid API key`

Check that the API key:

1. Exists in `.env`.
2. Was inserted into the `api_keys` table by the seed script.
3. Is being sent using the expected Authorization header.
4. Matches the stored API key.

---

# 19. Development URLs

| Service | URL |
|---|---|
| Frontend | `http://localhost:5173` |
| Backend | `http://127.0.0.1:8000` |
| Swagger | `http://127.0.0.1:8000/docs` |
| Health | `http://127.0.0.1:8000/health` |
| PostgreSQL | `localhost:5432` |

---

# 20. Summary

The project consists of:

```text
React + Vite
      |
      v
FastAPI
      |
      v
SQLAlchemy
      |
      v
PostgreSQL
```

Alembic manages the database schema, the seed script creates the initial admin/API-key configuration, and the EC2 sync clients communicate with the backend using API-key authentication.

For a new developer, PostgreSQL must be installed separately on the machine. Git only provides the project source code; it does not install PostgreSQL automatically.
"""

path = Path("/mnt/data/README.md")
path.write_text(readme, encoding="utf-8")

print(f"Created: {path}")
