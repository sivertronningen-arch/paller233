import os
import json
from functools import wraps

import psycopg2
import psycopg2.extras
from flask import Flask, render_template, request, jsonify, session, redirect, url_for


app = Flask(__name__)

# --- Config (set these in Render Environment) ---
# APP_PASSWORD=233
# DATABASE_URL=postgresql://postgres:PASS@db.xxx.supabase.co:5432/postgres
# SECRET_KEY=some-random-string

app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "233")
DATABASE_URL = os.environ.get("DATABASE_URL")


@app.after_request
def add_no_cache_headers(resp):
    """Avoid aggressive mobile caching so new deploys show up everywhere."""
    p = request.path or ""
    if p == "/" or p.startswith("/api/") or p.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    return resp


def _get_conn():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL mangler (sett i Render Environment)")
    # Supabase krever SSL
    return psycopg2.connect(DATABASE_URL, sslmode="require")


def _ensure_kv_table():
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                create table if not exists kv (
                  k text primary key,
                  v jsonb not null,
                  updated_at timestamptz not null default now()
                );
                """
            )


def _kv_get(key: str):
    _ensure_kv_table()
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("select v from kv where k=%s", (key,))
            row = cur.fetchone()
            return row["v"] if row else None


def _kv_set(key: str, value):
    _ensure_kv_table()
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into kv (k, v, updated_at)
                values (%s, %s::jsonb, now())
                on conflict (k) do update set v=excluded.v, updated_at=now();
                """,
                (key, json.dumps(value)),
            )


def require_login(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("ok"):
            return redirect(url_for("login"))
        return fn(*args, **kwargs)

    return wrapper


@app.before_request
def _gate():
    # Allow static assets + login endpoints
    if request.endpoint in {"login", "static"}:
        return
    if request.endpoint and request.endpoint.startswith("static"):
        return
    if not session.get("ok"):
        return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        pw = request.form.get("password", "")
        if pw == APP_PASSWORD:
            session["ok"] = True
            return redirect(url_for("index"))
        return render_template("login.html", error="Feil passord")
    return render_template("login.html", error=None)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@require_login
def index():
    return render_template("index.html")


@app.route("/api/state", methods=["GET"])
@require_login
def api_get_state():
    v = _kv_get("state")
    return jsonify({"ok": True, "state": v})


@app.route("/api/state", methods=["POST"])
@require_login
def api_set_state():
    data = request.get_json(silent=True) or {}
    state = data.get("state", None)
    if state is None:
        return jsonify({"ok": False, "error": "missing state"}), 400
    _kv_set("state", state)
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
