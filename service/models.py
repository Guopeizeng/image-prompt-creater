"""SQLite schema and low-level persistence helpers for PVOS."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Optional

from .settings import BASE_DIR, DATA_DIR, UPLOADS_DIR, PRIVATE_ASSETS_DIR, DB_PATH
from .version import VERSION, RELEASE_CHANGELOG


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db() -> sqlite3.Connection:
    """Get a database connection with foreign keys and WAL enabled."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _create_tables(cursor: sqlite3.Cursor) -> None:
    # Hosted Lite foundation
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS releases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT NOT NULL UNIQUE,
            release_date TEXT NOT NULL,
            changelog TEXT,
            is_current INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_name TEXT NOT NULL,
            session_id TEXT NOT NULL,
            release_version TEXT,
            timestamp TEXT NOT NULL,
            route_id TEXT,
            text_strategy TEXT,
            metadata_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rating TEXT NOT NULL,
            issue_type TEXT,
            comment TEXT,
            route_id TEXT,
            text_strategy TEXT,
            release_version TEXT,
            session_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            route_id TEXT,
            prompt_excerpt TEXT,
            allow_public_candidate INTEGER DEFAULT 0,
            status TEXT DEFAULT 'candidate',
            reviewed_at TEXT,
            reviewer_comment TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS submission_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id INTEGER NOT NULL,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            file_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS review_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            comment TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
        )
    """)

    # Agent-ready V5.16.1 workflow foundation
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            display_name TEXT,
            identity_notes_json TEXT NOT NULL DEFAULT '{}',
            must_preserve_json TEXT NOT NULL DEFAULT '[]',
            multiview_sheet TEXT,
            privacy_scope TEXT NOT NULL DEFAULT 'private',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS character_assets (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            storage_ref TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS workflow_runs (
            id TEXT PRIMARY KEY,
            character_id TEXT,
            intent TEXT NOT NULL DEFAULT '',
            subject_count INTEGER NOT NULL DEFAULT 1,
            mode TEXT NOT NULL DEFAULT 'assist',
            status TEXT NOT NULL DEFAULT 'created',
            route_id TEXT,
            text_strategy TEXT NOT NULL DEFAULT 'reserve-space',
            director_config_json TEXT NOT NULL DEFAULT '{}',
            recommended_routes_json TEXT NOT NULL DEFAULT '[]',
            selected_output_id TEXT,
            layout_plan_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS workflow_steps (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            step_type TEXT NOT NULL,
            status TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS artifacts (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            artifact_type TEXT NOT NULL,
            uri TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            is_selected INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS generation_queue_items (
            id TEXT PRIMARY KEY,
            queue_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT 'unassigned',
            variant_index INTEGER NOT NULL,
            prompt TEXT NOT NULL,
            director_config_json TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'queued',
            provider_job_id TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS approvals (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            gate TEXT NOT NULL,
            decision TEXT NOT NULL,
            comment TEXT,
            actor TEXT NOT NULL DEFAULT 'human',
            created_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS workflow_feedback (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            rating TEXT NOT NULL,
            comment TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS rule_update_proposals (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            rule_key TEXT NOT NULL,
            proposed_value_json TEXT NOT NULL,
            rationale TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'proposed',
            curator_comment TEXT,
            created_at TEXT NOT NULL,
            reviewed_at TEXT,
            FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        )
    """)

    # Indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_runs_status ON workflow_runs(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_runs_character ON workflow_runs(character_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_steps_run ON workflow_steps(run_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_generation_queue_run ON generation_queue_items(run_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_generation_queue_queue ON generation_queue_items(queue_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rule_updates_status ON rule_update_proposals(status)")


def init_db() -> None:
    """Initialize or migrate the SQLite database idempotently."""
    conn = get_db()
    cursor = conn.cursor()
    _create_tables(cursor)
    cursor.execute("UPDATE releases SET is_current = 0")
    cursor.execute("SELECT COUNT(*) FROM releases WHERE version = ?", (VERSION,))
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            "INSERT INTO releases (version, release_date, changelog, is_current) VALUES (?, ?, ?, 1)",
            (VERSION, datetime.now().strftime("%Y-%m-%d"), RELEASE_CHANGELOG),
        )
    else:
        cursor.execute("UPDATE releases SET is_current = 1, changelog = ? WHERE version = ?", (RELEASE_CHANGELOG, VERSION))
    conn.commit()
    conn.close()


def generate_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def generate_session_id() -> str:
    return uuid.uuid4().hex[:16]


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[dict]:
    return dict(row) if row is not None else None


init_db()
