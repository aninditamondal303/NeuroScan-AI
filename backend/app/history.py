"""Local analysis history in SQLite.

Stored per analysis: id, timestamp, status, class scores, uncertainty figures,
reasons/warnings, image format and dimensions, and model version.
Not stored: the image itself, the heatmap, or the original filename (filenames
often contain patient names or record numbers).
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Optional

from .schemas import AnalysisResult, HistoryEntry

MAX_ENTRIES_RETURNED = 500


class HistoryStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        with self._lock:
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS analyses (
                       analysis_id TEXT PRIMARY KEY,
                       created_at  TEXT NOT NULL,
                       status      TEXT NOT NULL,
                       payload     TEXT NOT NULL
                   )"""
            )
            self._conn.commit()

    @staticmethod
    def to_entry(result: AnalysisResult) -> HistoryEntry:
        return HistoryEntry(
            analysis_id=result.analysis_id,
            created_at=result.created_at,
            status=result.status,
            prediction=result.prediction,
            scores=result.scores,
            uncertainty=result.uncertainty,
            reasons=result.reasons,
            warnings=result.warnings,
            image=result.image,
            model=result.model,
        )

    def add(self, result: AnalysisResult) -> HistoryEntry:
        entry = self.to_entry(result)
        with self._lock:
            self._conn.execute(
                "INSERT INTO analyses (analysis_id, created_at, status, payload) VALUES (?, ?, ?, ?)",
                (entry.analysis_id, entry.created_at, entry.status, entry.model_dump_json()),
            )
            self._conn.commit()
        return entry

    def list(self) -> list[HistoryEntry]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT payload FROM analyses ORDER BY created_at DESC, rowid DESC LIMIT ?", (MAX_ENTRIES_RETURNED,)
            ).fetchall()
        return [HistoryEntry.model_validate(json.loads(r[0])) for r in rows]

    def get(self, analysis_id: str) -> Optional[HistoryEntry]:
        with self._lock:
            row = self._conn.execute("SELECT payload FROM analyses WHERE analysis_id = ?", (analysis_id,)).fetchone()
        return HistoryEntry.model_validate(json.loads(row[0])) if row else None

    def delete(self, analysis_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM analyses WHERE analysis_id = ?", (analysis_id,))
            self._conn.commit()
        return cur.rowcount > 0

    def clear(self) -> int:
        with self._lock:
            cur = self._conn.execute("DELETE FROM analyses")
            self._conn.commit()
        return cur.rowcount

    def close(self) -> None:
        with self._lock:
            self._conn.close()
