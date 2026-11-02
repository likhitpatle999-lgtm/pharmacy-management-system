
import os
import sqlite3
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from dotenv import load_dotenv
from pwdlib import PasswordHash

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field


# ---------- CONFIGURATION ----------

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET")

if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET missing. Add it to your .env file.")

JWT_ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60

password_hash = PasswordHash.recommended()
security = HTTPBearer()

app = FastAPI(title="Pharmacy Management System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_NAME = "pharmacy.db"


# ---------- DATABASE ----------

def connect_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def create_tables():
    with connect_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS medicines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 0,
                price REAL NOT NULL DEFAULT 0,
                expiry_date TEXT
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)


create_tables()


# ---------- REQUEST MODELS ----------

class SignupInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginInput(BaseModel):
    email: str
    password: str


class MedicineInput(BaseModel):
    name: str = Field(min_length=1)
    category: str = Field(min_length=1)
    quantity: int = Field(ge=0)
    price: float = Field(ge=0)
    expiry_date: Optional[str] = None


# ---------- TOKEN FUNCTIONS ----------

def create_access_token(user_id: int):
    expires = datetime.now(timezone.utc) + timedelta(
        minutes=TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": str(user_id),
        "exp": expires
    }

    return jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM]
        )

        user_id = int(payload["sub"])

    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired login token"
        )

    with connect_db() as conn:
        user = conn.execute(
            "SELECT id, name, email FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="User not found"
        )

    return dict(user)


# ---------- HOME ----------

@app.get("/")
def home():
    return {
        "message": "Pharmacy Backend is running",
        "database": "SQLite"
    }


# ---------- SIGNUP ----------

@app.post("/signup", status_code=201)
def signup(data: SignupInput):
    name = data.name.strip()
    email = data.email.strip().lower()
    password = data.password

    if not name:
        raise HTTPException(400, "Name is required")

    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(400, "Enter a valid email address")

    hashed_password = password_hash.hash(password)

    try:
        with connect_db() as conn:
            cursor = conn.execute("""
                INSERT INTO users (name, email, password_hash)
                VALUES (?, ?, ?)
            """, (name, email, hashed_password))

            user_id = cursor.lastrowid

    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="Email is already registered"
        )

    token = create_access_token(user_id)

    return {
        "message": "Account created successfully",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "name": name,
            "email": email
        }
    }


# ---------- LOGIN ----------

@app.post("/login")
def login(data: LoginInput):
    email = data.email.strip().lower()

    with connect_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        ).fetchone()

    if user is None or not password_hash.verify(
        data.password,
        user["password_hash"]
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password"
        )

    token = create_access_token(user["id"])

    return {
        "message": "Login successful",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"]
        }
    }


# ---------- CURRENT USER ----------

@app.get("/me")
def get_me(user: dict = Depends(get_current_user)):
    return user


# ---------- GET MEDICINES ----------

@app.get("/medicines")
def get_medicines(user: dict = Depends(get_current_user)):
    with connect_db() as conn:
        rows = conn.execute(
            "SELECT * FROM medicines ORDER BY id DESC"
        ).fetchall()

    return [dict(row) for row in rows]


# ---------- ADD MEDICINE ----------

@app.post("/medicines", status_code=201)
def add_medicine(
    data: MedicineInput,
    user: dict = Depends(get_current_user)
):
    name = data.name.strip()
    category = data.category.strip()

    if not name or not category:
        raise HTTPException(400, "Name and category are required")

    with connect_db() as conn:
        cursor = conn.execute("""
            INSERT INTO medicines
            (name, category, quantity, price, expiry_date)
            VALUES (?, ?, ?, ?, ?)
        """, (
            name,
            category,
            data.quantity,
            data.price,
            data.expiry_date
        ))

        medicine_id = cursor.lastrowid

        row = conn.execute(
            "SELECT * FROM medicines WHERE id = ?",
            (medicine_id,)
        ).fetchone()

    return dict(row)


# ---------- DELETE MEDICINE ----------

@app.delete("/medicines/{medicine_id}")
def delete_medicine(
    medicine_id: int,
    user: dict = Depends(get_current_user)
):
    with connect_db() as conn:
        cursor = conn.execute(
            "DELETE FROM medicines WHERE id = ?",
            (medicine_id,)
        )

        if cursor.rowcount == 0:
            raise HTTPException(404, "Medicine not found")

    return {
        "message": "Medicine deleted successfully",
        "id": medicine_id
    }
