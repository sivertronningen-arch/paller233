from __future__ import annotations

import json
import os
from dataclasses import dataclass
from flask import Flask, jsonify, request, render_template

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(APP_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
LAYOUT_PATH = os.path.join(DATA_DIR, "layout.json")

app = Flask(__name__)


def _default_layout() -> dict:
    return {
        "version": 2,
        "canvas": {"width": 1200, "height": 700, "grid": 20},
        "items": [],
        "counters": {"pallet": 0, "endegavel": 0, "group": 0},
    }


def load_layout() -> dict:
    if not os.path.exists(LAYOUT_PATH):
        layout = _default_layout()
        save_layout(layout)
        return layout
    try:
        with open(LAYOUT_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        layout = _default_layout()
        save_layout(layout)
        return layout


def save_layout(layout: dict) -> None:
    tmp = LAYOUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(layout, f, ensure_ascii=False, indent=2)
    os.replace(tmp, LAYOUT_PATH)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/layout")
def api_get_layout():
    return jsonify(load_layout())


@app.post("/api/layout")
def api_save_layout():
    layout = request.get_json(force=True, silent=True)
    if not isinstance(layout, dict):
        return jsonify({"error": "Invalid JSON"}), 400

    # light validation
    if "items" not in layout or not isinstance(layout["items"], list):
        return jsonify({"error": "Layout must contain items[]"}), 400

    # keep required fields
    existing = load_layout()
    layout.setdefault("version", existing.get("version", 2))
    layout.setdefault("canvas", existing.get("canvas", {"width": 1200, "height": 700, "grid": 20}))
    layout.setdefault("counters", existing.get("counters", {"pallet": 0, "endegavel": 0, "group": 0}))

    save_layout(layout)
    return jsonify({"ok": True})


@app.post("/api/reset")
def api_reset():
    layout = _default_layout()
    save_layout(layout)
    return jsonify({"ok": True})


if __name__ == "__main__":
    # For local dev
    app.run(host="0.0.0.0", port=5000, debug=True)
