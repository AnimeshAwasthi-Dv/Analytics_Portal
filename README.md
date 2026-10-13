# DecXpert Control Panel — Backend Setup Guide

A step-by-step guide to installing PostgreSQL, configuring the database, setting up the Python environment, and running the FastAPI backend on Windows.

## 1. Project Overview

The backend is built using:

| Technology | Purpose                      |
| ---------- | ---------------------------- |
| Python     | Backend programming language |
| FastAPI    | REST API framework           |
| PostgreSQL | Relational database          |
| SQLAlchemy | ORM and database interaction |
| Pydantic   | Request validation           |
| JWT        | Authentication               |
| Argon2     | Password hashing             |
| Uvicorn    | ASGI development server      |

## 2. Prerequisites

Install the following software before starting:

* Python 3.11 or later
* PostgreSQL (native Windows installation)
* Git
* VS Code (recommended)

Verify Python and Git:

```bash
python --version
git --version
```

Verify PostgreSQL:

```bash
psql --version
```

If `psql` is not recognized, add the PostgreSQL `bin` directory to your Windows PATH or use SQL Shell (psql) from the Start menu.

## 3. Install PostgreSQL

1. Download PostgreSQL from the official website:

   https://www.postgresql.org/download/windows/

2. Run the installer.

3. Select PostgreSQL Server and Command Line Tools.

4. Set a password for the default `postgres` superuser.

5. Keep the default port as `5432`.

6. Complete the installation.

### Verify the PostgreSQL service

Open Windows Services:

```text
Win + R → services.msc
```

Find the PostgreSQL service and verify that its status is Running.

PostgreSQL runs as a Windows service, so it does not need Docker or a separate terminal window.

## 4. Create the Database and User

Open **SQL Shell (psql)** from the Windows Start menu.

Connect using:

| Setting  | Value                                 |
| -------- | ------------------------------------- |
| Server   | localhost                             |
| Database | postgres                              |
| Port     | 5432                                  |
| Username | postgres                              |
| Password | Your PostgreSQL installation password |

Press Enter to accept the default values where appropriate.

### Create the application user

```sql
CREATE USER central_sync WITH PASSWORD 'YOUR_DB_PASSWORD';
```

Replace `YOUR_DB_PASSWORD` with a secure password of your choice.

### Create the database

```sql
CREATE DATABASE central_sync OWNER central_sync;
```

### Verify database creation

```sql
\l
```

You should see `central_sync` in the database list.

Connect to the new database:

```sql
\c central_sync
```

Exit PostgreSQL:

```sql
\q
```

## 5. Clone or Open the Project

Navigate to the project directory:

```bash
cd /d/CDS/backend
```

If cloning from GitHub, use the repository URL supplied by the project team.

The backend directory should contain:

```text
backend/
│
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── auth.py
│   ├── routes.py
│   └── seed.py
│
├── .env
├── .env.example
├── requirements.txt
└── venv/
```

The `venv` folder is created locally and should not be committed to Git.

## 6. Create a Python Virtual Environment

From the backend directory:

```bash
python -m venv venv
```

Activate it in Git Bash:

```bash
source venv/Scripts/activate
```

For PowerShell:

```powershell
.\venv\Scripts\Activate.ps1
```

After activation, the terminal should show:

```text
(venv)
```

## 7. Install Python Dependencies

Upgrade pip:

```bash
python -m pip install --upgrade pip
```

Install project dependencies:

```bash
python -m pip install -r requirements.txt
```

The requirements include:

* fastapi
* uvicorn
* sqlalchemy
* psycopg
* python-dotenv
* python-jose
* pwdlib with Argon2
* pydantic[email]

If the dependency file is missing or outdated, update it with the project team's approved dependency list before continuing.

## 8. Configure Environment Variables

Create a `.env` file in the backend root directory.

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=central_sync
DATABASE_USER=central_sync
DATABASE_PASSWORD=YOUR_DB_PASSWORD

JWT_SECRET=YOUR_RANDOM_SECRET
JWT_ALGORITHM=HS256
JWT_EXPIRATION=60

INITIAL_ADMIN_EMAIL=admin@local.com
INITIAL_ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD
```

### Important

* `DATABASE_PASSWORD` is the password of the PostgreSQL user.
* `INITIAL_ADMIN_PASSWORD` is the password used to log into the portal.
* These are two separate credentials.
* `JWT_SECRET` is used for signing authentication tokens. Do not use your admin password for this.
* Never commit `.env` to Git.

The **Control** tab is available only to the account whose email matches
`INITIAL_ADMIN_EMAIL`. Adding an API key or user requires confirming that
account's password. API key values are hashed in the `api_keys` table, and
new user passwords are hashed in the `users` table before they are saved.
Newly created users have standard access and cannot open Control.

Generate a random JWT secret using:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the generated value into `JWT_SECRET`.

## 9. Test the PostgreSQL Connection

Make sure PostgreSQL is running.

From the backend directory, with the virtual environment activated:

```bash
python -c "from app.database import engine; c=engine.connect(); print('PostgreSQL connection successful'); c.close()"
```

Expected output:

```text
PostgreSQL connection successful
```

If this fails, verify the database name, username, password, host, and port in `.env`.

## 10. Create Database Tables

Run:

```bash
python -c "from app.database import Base, engine; import app.models; Base.metadata.create_all(bind=engine); print('Database tables created')"
```

This creates the tables defined in the SQLAlchemy models if they do not already exist.

The current application also calls `create_all()` during FastAPI startup.

## 11. Create the Initial Admin Account

Run:

```bash
python -m app.seed
```

Expected output:

```text
Admin account created successfully!
Email: admin@local.com
```

The email shown will depend on `INITIAL_ADMIN_EMAIL` in your `.env`.

If the admin already exists, the seed script should report that the account already exists instead of creating a duplicate.

## 12. Start the FastAPI Backend

From the backend directory:

```bash
uvicorn app.main:app --reload
```

Expected output includes:

```text
Uvicorn running on http://127.0.0.1:8000
Application startup complete.
```

Keep this terminal open while using the application.

### Backend URLs

| URL                          | Purpose                   |
| ---------------------------- | ------------------------- |
| http://127.0.0.1:8000        | Root API                  |
| http://127.0.0.1:8000/docs   | Swagger API documentation |
| http://127.0.0.1:8000/redoc  | ReDoc API documentation   |
| http://127.0.0.1:8000/health | Health check              |

Open Swagger to test the API endpoints interactively.

## 13. Authentication

The initial admin credentials are configured through:

```env
INITIAL_ADMIN_EMAIL=admin@local.com
INITIAL_ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD
```

The login endpoint is:

```http
POST /auth/login
```

Example JSON request:

```json
{
  "email": "admin@local.com",
  "password": "YOUR_ADMIN_PASSWORD"
}
```

A successful login sets an HTTP-only authentication cookie.

The current user can be checked using:

```http
GET /auth/me
```

Logout:

```http
POST /auth/logout
```

## 14. Frontend Connection

The React frontend runs at:

```text
http://localhost:5173
```

The backend CORS configuration should allow this origin with credentials enabled:

```python
allow_origins=["http://localhost:5173"]
allow_credentials=True
allow_methods=["*"]
allow_headers=["*"]
```

The frontend should use:

```javascript
const API = "http://localhost:8000";
```

Use `credentials: "include"` in frontend fetch requests so the browser sends the authentication cookie.

For local development, use `localhost` consistently for both frontend and backend.

## 15. Common Errors

### Error: `ModuleNotFoundError`

Activate the virtual environment and reinstall dependencies:

```bash
source venv/Scripts/activate
python -m pip install -r requirements.txt
```

### Error: PostgreSQL connection refused

Check whether the PostgreSQL Windows service is running.

Also verify:

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
```

### Error: Password authentication failed

Check the PostgreSQL username and password in `.env`.

Remember that the database password and portal admin password are different.

### Error: `401 Unauthorized`

Verify that:

* Login succeeded.
* The browser stored the authentication cookie.
* Frontend requests use `credentials: "include"`.
* The JWT secret has not changed since the token was issued.
* Frontend and backend use consistent `localhost` URLs.

### Error: `422 Unprocessable Entity`

Check the request body against the endpoint's Pydantic schema.

For login, use `email` and `password`, not `username`.

### Error: `No module named 'passlib'`

The current project uses `pwdlib` with Argon2 rather than Passlib. Check `app/auth.py` and `requirements.txt` for outdated imports or dependencies.

## 16. Daily Startup

After the initial setup, you do not need to repeat PostgreSQL installation, database creation, or dependency installation.

### Start PostgreSQL

Verify the Windows PostgreSQL service is running.

### Start the backend

```bash
cd /d/CDS/backend
source venv/Scripts/activate
uvicorn app.main:app --reload
```

### Start the frontend

Open another terminal:

```bash
cd /d/CDS/frontend
npm run dev
```

Open:

http://localhost:5173

---

## Development Notes

* Do not commit `.env`, database passwords, JWT secrets, or access tokens.
* Do not commit the local `venv` or `node_modules` directories.
* Use a separate database for development and testing where practical.
* The current database table creation uses SQLAlchemy `create_all()`. Use migrations for future schema changes.
* The default local cookie configuration is intended for development, not production deployment.

**DecXpert Control Panel — Backend Setup Guide**
