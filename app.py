import os
import json
from functools import wraps

from supabase import create_client
from flask import Flask, render_template, request, jsonify, session, redirect, url_for

app = Flask(__name__)

# --- Config (set these in Render Environment) ---
# APP_PASSWORD=233
# SUPABASE_URL=https://<project-ref>.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=<service role key>
# SECRET_KEY=some-random-string

app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "233")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

_sb_client = None


@app.after_request
def add_no_cache_headers(resp):
    """Avoid aggressive mobile caching so new deploys show up everywhere."""
    p = request.path or ""
    if p == "/" or p.startswith("/api/") or p.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    return resp


def _sb():
    """Return a cached Supabase client using HTTPS API (port 443)."""
    global _sb_client
    if _sb_client is not None:
        return _sb_client

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler (sett i Render Environment)"
        )

    _sb_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _sb_client


def _ensure_kv_table():
    """Ensure the 'kv' table exists.

    Supabase REST API cannot create tables. If the table is missing, we raise a
    clear error telling exactly what SQL to run.
    """
    try:
        _sb().table("kv").select("k").limit(1).execute()
    except Exception as e:
        raise RuntimeError(
            "Fant ikke tabellen 'kv' i Supabase. Lag den i Supabase -> SQL Editor med:\n\n"
            "create table if not exists kv (\n"
            "  k text primary key,\n"
            "  v jsonb not null,\n"
            "  updated_at timestamptz not null default now()\n"
            ");\n"
        ) from e


def _kv_get(key: str):
    _ensure_kv_table()
    res = _sb().table("kv").select("v").eq("k", key).maybe_single().execute()
    if not res.data:
        return None
    return res.data.get("v")


def _kv_set(key: str, value):
    _ensure_kv_table()
    payload = {"k": key, "v": value}
    # Upsert on primary key 'k'
    _sb().table("kv").upsert(payload, on_conflict="k").execute()


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

    # Ensure it's JSON-serializable
    json.dumps(state)

    _kv_set("state", state)
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
