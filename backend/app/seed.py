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
    # PORTAL API KEYS
    # ==================================================

    api_keys = [
        {
            "name": "Marengo",
            "env": "MARENGO_API_KEY",
        },
        {
            "name": "Pacs Central",
            "env": "PACS_API_KEY",
        },
        {
            "name": "API Control",
            "env": "API_CONTROL_KEY",
        },
        {
            "name": "Portal Key 4",
            "env": "PORTAL_API_KEY_4",
        },
        {
            "name": "Portal Key 5",
            "env": "PORTAL_API_KEY_5",
        },
    ]

    for item in api_keys:
        key_name = item["name"]
        env_name = item["env"]

        api_key_value = os.getenv(env_name)

        # Skip keys that have not been configured yet
        if not api_key_value:
            print(
                f"Skipping {key_name}: "
                f"{env_name} is not configured."
            )
            continue

        existing_api_key = (
            db.query(ApiKey)
            .filter(ApiKey.key_name == key_name)
            .first()
        )

        if existing_api_key:
            print(
                f"{key_name} API key already exists."
            )
        else:
            api_key = ApiKey(
                key_name=key_name,
                api_key=api_key_value
            )

            db.add(api_key)
            db.commit()

            print(
                f"{key_name} API key created successfully!"
            )

finally:
    db.close()