from __future__ import annotations

import os
import sqlite3
from typing import Any, Iterable, List, Tuple

from flask import Flask, g, jsonify, request, render_template, send_from_directory, redirect, url_for, session

APP_DIR = os.path.dirname(os.path.abspath(__file__))

# -----------------------------
# Config
# -----------------------------
# Password protection (single shared password).
# You asked for password "233". You can override it in hosting by setting APP_PASSWORD.
APP_PASSWORD = os.environ.get("APP_PASSWORD", "233")

# IMPORTANT: Set a strong secret key in hosting (Render "Environment Variables").
# If you don't set it, users may be logged out on restarts/redeploys.
SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-in-hosting-please")

# Database:
# - Default (local): SQLite file
# - If DATABASE_URL is set to a Postgres URL, we'll use Postgres (recommended for cloud so data doesn't disappear).
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
SQLITE_PATH = os.environ.get("SQLITE_PATH", os.path.join(APP_DIR, "data.sqlite3"))

app = Flask(__name__)
app.secret_key = SECRET_KEY


# -----------------------------
# DB helpers (SQLite or Postgres)
# -----------------------------
def _is_postgres() -> bool:
    u = DATABASE_URL.lower()
    return u.startswith("postgres://") or u.startswith("postgresql://")


def get_db():
    db = getattr(g, "_db", None)
    if db is not None:
        return db

    if _is_postgres():
        import psycopg2
        conn = psycopg2.connect(DATABASE_URL)  # accepts postgres:// and postgresql://
        conn.autocommit = False
        g._db = ("postgres", conn)
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        g._db = ("sqlite", conn)
    return g._db


@app.teardown_appcontext
def close_db(exc):
    db = getattr(g, "_db", None)
    if db is None:
        return
    _, conn = db
    try:
        conn.close()
    except Exception:
        pass


def init_db():
    if _is_postgres():
        import psycopg2
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
        CREATE TABLE IF NOT EXISTS pallets(
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            x DOUBLE PRECISION NOT NULL,
            y DOUBLE PRECISION NOT NULL,
            w DOUBLE PRECISION NOT NULL,
            h DOUBLE PRECISION NOT NULL
        );
        """)
        cur.execute("""
        CREATE TABLE IF NOT EXISTS placements(
            pallet_id INTEGER NOT NULL REFERENCES pallets(id) ON DELETE CASCADE,
            article TEXT NOT NULL,
            UNIQUE(pallet_id, article)
        );
        """)
        conn.commit()
        conn.close()
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        cur = conn.cursor()
        cur.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS pallets(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            w REAL NOT NULL,
            h REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS placements(
            pallet_id INTEGER NOT NULL,
            article TEXT NOT NULL,
            UNIQUE(pallet_id, article),
            FOREIGN KEY(pallet_id) REFERENCES pallets(id) ON DELETE CASCADE
        );
        """)
        conn.commit()
        conn.close()


def db_execute(sql_sqlite: str, sql_pg: str, params: Tuple[Any, ...] = (), fetch: bool = False):
    dbtype, conn = get_db()
    if dbtype == "postgres":
        cur = conn.cursor()
        cur.execute(sql_pg, params)
        rows = cur.fetchall() if fetch else None
        return rows, cur
    else:
        cur = conn.execute(sql_sqlite, params)
        rows = cur.fetchall() if fetch else None
        return rows, cur


def db_executemany(sql_sqlite: str, sql_pg: str, seq: Iterable[Tuple[Any, ...]]):
    dbtype, conn = get_db()
    if dbtype == "postgres":
        cur = conn.cursor()
        cur.executemany(sql_pg, list(seq))
        return cur
    else:
        cur = conn.executemany(sql_sqlite, list(seq))
        return cur


def db_commit():
    dbtype, conn = get_db()
    conn.commit()


def next_pallet_name() -> str:
    rows, _ = db_execute(
        "SELECT COUNT(*) as c FROM pallets",
        "SELECT COUNT(*) as c FROM pallets",
        fetch=True
    )
    c = rows[0][0] if isinstance(rows[0], tuple) else rows[0]["c"]
    return f"Pall {int(c) + 1}"


# Initialize tables at startup
init_db()


# -----------------------------
# Auth (single shared password)
# -----------------------------
def _is_authed() -> bool:
    return session.get("authed") is True


@app.before_request
def require_login():
    if request.path.startswith("/static/"):
        return None
    if request.endpoint in ("login", "logout"):
        return None

    if not _is_authed():
        if request.path.startswith("/api/"):
            return jsonify({"error": "Ikke innlogget."}), 401
        return redirect(url_for("login"))
    return None


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        pw = (request.form.get("password") or "").strip()
        if pw == APP_PASSWORD:
            session["authed"] = True
            return redirect(url_for("index"))
        return render_template("login.html", error="Feil passord.")
    return render_template("login.html", error=None)


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# -----------------------------
# Pages
# -----------------------------
@app.route("/")
def index():
    return render_template("index.html")


# -----------------------------
# API
# -----------------------------
@app.get("/api/pallets")
def api_get_pallets():
    pallets_rows, _ = db_execute(
        "SELECT * FROM pallets ORDER BY id",
        "SELECT id, name, x, y, w, h FROM pallets ORDER BY id",
        fetch=True
    )
    out = []
    for p in pallets_rows:
        pid = p[0] if isinstance(p, tuple) else p["id"]
        arts_rows, _ = db_execute(
            "SELECT article FROM placements WHERE pallet_id=? ORDER BY article",
            "SELECT article FROM placements WHERE pallet_id=%s ORDER BY article",
            (pid,),
            fetch=True
        )
        arts = [r[0] if isinstance(r, tuple) else r["article"] for r in arts_rows]
        out.append({
            "id": pid,
            "name": (p[1] if isinstance(p, tuple) else p["name"]),
            "x": (p[2] if isinstance(p, tuple) else p["x"]),
            "y": (p[3] if isinstance(p, tuple) else p["y"]),
            "w": (p[4] if isinstance(p, tuple) else p["w"]),
            "h": (p[5] if isinstance(p, tuple) else p["h"]),
            "articles": arts
        })
    return jsonify(out)


@app.post("/api/pallets")
def api_create_pallet():
    data = request.get_json(force=True, silent=True) or {}
    try:
        x = float(data["x"]); y = float(data["y"]); w = float(data["w"]); h = float(data["h"])
    except Exception:
        return jsonify({"error": "Mangler/ugyldige koordinater (x,y,w,h)."}), 400
    if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
        return jsonify({"error": "Koordinater må være relative verdier mellom 0 og 1."}), 400

    name = next_pallet_name()
    _, cur = db_execute(
        "INSERT INTO pallets(name,x,y,w,h) VALUES (?,?,?,?,?)",
        "INSERT INTO pallets(name,x,y,w,h) VALUES (%s,%s,%s,%s,%s) RETURNING id",
        (name, x, y, w, h),
        fetch=False
    )

    dbtype, _conn = get_db()
    pid = cur.fetchone()[0] if dbtype == "postgres" else cur.lastrowid
    db_commit()
    return jsonify({"id": pid, "name": name})


@app.delete("/api/pallets/<int:pallet_id>")
def api_delete_pallet(pallet_id: int):
    db_execute(
        "DELETE FROM placements WHERE pallet_id=?",
        "DELETE FROM placements WHERE pallet_id=%s",
        (pallet_id,)
    )
    _, cur = db_execute(
        "DELETE FROM pallets WHERE id=?",
        "DELETE FROM pallets WHERE id=%s",
        (pallet_id,)
    )
    db_commit()
    if cur.rowcount == 0:
        return jsonify({"error": "Fant ikke pall."}), 404
    return jsonify({"ok": True})


@app.put("/api/pallets/<int:pallet_id>/articles")
def api_set_articles(pallet_id: int):
    data = request.get_json(force=True, silent=True) or {}
    arts = data.get("articles", None)
    if arts is None or not isinstance(arts, list):
        return jsonify({"error": "Forventer JSON: {articles: [..]}"}), 400

    clean: List[str] = []
    seen = set()
    for a in arts:
        if a is None:
            continue
        s = str(a).strip()
        if not s:
            continue
        if s in seen:
            continue
        seen.add(s)
        clean.append(s)

    rows, _ = db_execute(
        "SELECT id FROM pallets WHERE id=?",
        "SELECT id FROM pallets WHERE id=%s",
        (pallet_id,),
        fetch=True
    )
    if not rows:
        return jsonify({"error": "Fant ikke pall."}), 404

    db_execute(
        "DELETE FROM placements WHERE pallet_id=?",
        "DELETE FROM placements WHERE pallet_id=%s",
        (pallet_id,)
    )
    db_executemany(
        "INSERT OR IGNORE INTO placements(pallet_id, article) VALUES (?,?)",
        "INSERT INTO placements(pallet_id, article) VALUES (%s,%s) ON CONFLICT DO NOTHING",
        [(pallet_id, a) for a in clean]
    )
    db_commit()
    return jsonify({"ok": True, "articles": clean})


@app.get("/api/search")
def api_search():
    article = (request.args.get("article") or "").strip()
    if not article:
        return jsonify({"error": "Mangler ?article="}), 400

    rows, _ = db_execute(
        """
        SELECT p.id, p.name, p.x, p.y, p.w, p.h
        FROM pallets p
        JOIN placements pl ON pl.pallet_id = p.id
        WHERE pl.article = ?
        ORDER BY p.id
        """,
        """
        SELECT p.id, p.name, p.x, p.y, p.w, p.h
        FROM pallets p
        JOIN placements pl ON pl.pallet_id = p.id
        WHERE pl.article = %s
        ORDER BY p.id
        """,
        (article,),
        fetch=True
    )
    matches = []
    for r in rows:
        if isinstance(r, tuple):
            matches.append({"id": r[0], "name": r[1], "x": r[2], "y": r[3], "w": r[4], "h": r[5]})
        else:
            matches.append(dict(r))
    return jsonify({"article": article, "matches": matches})


# -----------------------------
# Static
# -----------------------------
@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(os.path.join(APP_DIR, "static"), filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
