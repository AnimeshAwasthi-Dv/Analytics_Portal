from getpass import getpass

from app.database import SessionLocal
from app.models import User
from app.auth import hash_password

email = "admin@local.com"

new_password = getpass("Enter new admin password: ")
confirm_password = getpass("Confirm new admin password: ")

if new_password != confirm_password:
    raise ValueError("Passwords do not match")

if len(new_password) < 8:
    raise ValueError("Password must be at least 8 characters")

db = SessionLocal()

try:
    user = db.query(User).filter(User.email == email).first()

    if user is None:
        print("Admin user not found")
    else:
        user.hashed_password = hash_password(new_password)
        user.is_active = True
        db.commit()
        print("Password updated successfully!")

finally:
    db.close()