from app.database import SessionLocal
from app.models import User, ApiKey
from app.auth import hash_password
from dotenv import load_dotenv
import os

load_dotenv()

db = SessionLocal()

try:
    # ==================================================
    # ADMIN USER
    # ==================================================

    email = os.getenv(
        "INITIAL_ADMIN_EMAIL",
        "admin@central-sync.com"
    )

    password = os.getenv("INITIAL_ADMIN_PASSWORD")

    if not password:
        raise ValueError(
            "INITIAL_ADMIN_PASSWORD is missing in .env"
        )

    existing_user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )

    if existing_user:
        print("Admin account already exists:", email)
    else:
        admin = User(
            name="Admin",
            email=email,
            hashed_password=hash_password(password),
            is_active=True
        )

        db.add(admin)
        db.commit()

        print("Admin account created successfully!")
        print("Email:", email)

    # ==================================================
    # MARENGO API KEY
    # ==================================================

    marengo_api_key = os.getenv("MARENGO_API_KEY")

    if not marengo_api_key:
        raise ValueError(
            "MARENGO_API_KEY is missing in .env"
        )

    existing_api_key = (
        db.query(ApiKey)
        .filter(ApiKey.key_name == "Marengo")
        .first()
    )

    if existing_api_key:
        print("Marengo API key already exists.")
    else:
        api_key = ApiKey(
            key_name="Marengo",
            api_key=marengo_api_key
        )

        db.add(api_key)
        db.commit()

        print("Marengo API key created successfully!")

finally:
    db.close()