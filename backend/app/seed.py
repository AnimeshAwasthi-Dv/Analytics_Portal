
from app.database import SessionLocal
from app.models import User
from app.auth import hash_password
from dotenv import load_dotenv
import os

load_dotenv()

db = SessionLocal()

try:
    email = os.getenv("INITIAL_ADMIN_EMAIL", "admin@central-sync.com")
    password = os.getenv("INITIAL_ADMIN_PASSWORD")

    if not password:
        raise ValueError("INITIAL_ADMIN_PASSWORD is missing in .env")

    existing_user = db.query(User).filter(User.email == email).first()

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

finally:
    db.close()