"""PVOS V6.1.1 Poster Structure Runtime - FastAPI application over the sealed 5.16.1 visual core."""

from __future__ import annotations

import json
import os
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from core.library_loader import get_manifest
from core.prompt_compiler import compile_prompt
from . import agent_commands
from .api_v1 import router as agent_ready_router
from .models import BASE_DIR, DB_PATH, UPLOADS_DIR, generate_session_id, get_db, init_db, row_to_dict
from .schemas import (
    AdminStatsResponse, DirectorConfig, EventCreate, FeedbackCreate, HealthResponse,
    LibraryManifestResponse, ReleaseResponse, ReviewActionCreate, RuleUpdateReview,
    SubmissionCreate,
)
from .settings import cors_origins, expose_storage_paths
from .version import PRODUCT_NAME, RUNTIME_NAME, VERSION, VISUAL_CORE_VERSION, RUNTIME_BUILD, UI_BUILD

ALLOWED_EVENTS = {
    "app_open", "route_selected", "text_strategy_changed", "prompt_copied",
    "layout_opened", "base_image_uploaded", "poster_exported",
    "feedback_submitted", "submission_created",
}
ALLOWED_FILE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".json"}
MAX_FILE_SIZE = 8 * 1024 * 1024
MAX_TOTAL_UPLOAD_SIZE = 20 * 1024 * 1024
MAX_FILES = 5
MAX_FILENAME_LENGTH = 180
FORBIDDEN_METADATA_KEYS = {
    "name", "real_name", "真实姓名", "phone", "tel", "mobile", "电话", "手机",
    "email", "mail", "邮箱", "address", "location", "地址", "地理位置",
    "fingerprint", "browser_fingerprint", "浏览器指纹", "original_image", "raw_image",
    "原始图片", "full_prompt", "complete_prompt", "完整prompt", "完整Prompt",
}

# Legacy import-time snapshot retained for compatibility diagnostics only.
# Authorization always reads the environment at request time via require_admin().
ADMIN_PASSWORD = os.environ.get("PVOS_ADMIN_PASSWORD") or None

RATE_LIMIT_DEFAULTS = {
    "/api/events": 120,
    "/api/prompts/compile": 60,
    "/api/feedback": 20,
    "/api/submissions": 5,
}
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_BUCKETS = 5000
_RATE_LIMIT_BUCKETS: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_RATE_LIMIT_LOCK = Lock()
_RATE_LIMIT_LAST_SWEEP = 0.0


def rate_limit_enabled() -> bool:
    """Enable lightweight per-client limits for public demos or explicit deployments."""
    raw = os.environ.get("PVOS_RATE_LIMIT_ENABLED")
    if raw is not None:
        return raw.strip().lower() in {"1", "true", "yes"}
    return is_public_demo()


def _rate_limit_value(path: str) -> int:
    env_key = "PVOS_RATE_LIMIT_" + path.rsplit("/", 1)[-1].replace("-", "_").upper() + "_PER_MINUTE"
    raw = os.environ.get(env_key)
    if raw is None:
        return RATE_LIMIT_DEFAULTS[path]
    try:
        return max(1, int(raw))
    except ValueError:
        return RATE_LIMIT_DEFAULTS[path]


def _client_key(request: Request) -> str:
    trust_proxy = os.environ.get("PVOS_TRUST_PROXY_HEADERS", "false").lower() in {"1", "true", "yes"}
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def reset_rate_limit_state() -> None:
    """Test and maintenance hook: clear in-memory request buckets."""
    with _RATE_LIMIT_LOCK:
        _RATE_LIMIT_BUCKETS.clear()


def _sweep_rate_limit_buckets(now: float, cutoff: float) -> None:
    """Bound in-memory limiter state even when many client keys appear."""
    global _RATE_LIMIT_LAST_SWEEP
    if now - _RATE_LIMIT_LAST_SWEEP < RATE_LIMIT_WINDOW_SECONDS and len(_RATE_LIMIT_BUCKETS) <= RATE_LIMIT_MAX_BUCKETS:
        return
    for key, bucket in list(_RATE_LIMIT_BUCKETS.items()):
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if not bucket:
            _RATE_LIMIT_BUCKETS.pop(key, None)
    if len(_RATE_LIMIT_BUCKETS) > RATE_LIMIT_MAX_BUCKETS:
        ordered = sorted(_RATE_LIMIT_BUCKETS.items(), key=lambda item: item[1][0] if item[1] else 0.0)
        for key, _ in ordered[: len(_RATE_LIMIT_BUCKETS) - RATE_LIMIT_MAX_BUCKETS]:
            _RATE_LIMIT_BUCKETS.pop(key, None)
    _RATE_LIMIT_LAST_SWEEP = now


def _consume_rate_limit(request: Request) -> tuple[bool, int, int, int]:
    path = request.url.path
    limit = _rate_limit_value(path)
    now = monotonic()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    bucket_key = (_client_key(request), path)
    with _RATE_LIMIT_LOCK:
        _sweep_rate_limit_buckets(now, cutoff)
        bucket = _RATE_LIMIT_BUCKETS[bucket_key]
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(1, int(RATE_LIMIT_WINDOW_SECONDS - (now - bucket[0])))
            return False, limit, 0, retry_after
        bucket.append(now)
        remaining = max(0, limit - len(bucket))
    return True, limit, remaining, RATE_LIMIT_WINDOW_SECONDS


def require_admin(password: Optional[str] = None) -> bool:
    """Read the admin secret at request time to avoid stale module state after reloads."""
    expected = os.environ.get("PVOS_ADMIN_PASSWORD") or None
    return bool(expected and password and password == expected)


def is_public_demo() -> bool:
    """Public demo deployments block sensitive uploads (read at request time)."""
    return os.environ.get("PVOS_PUBLIC_DEMO", "").strip().lower() in {"1", "true", "yes"}


def _sanitize_value(value):
    if isinstance(value, dict):
        return {
            key: _sanitize_value(item)
            for key, item in value.items()
            if str(key).lower() not in FORBIDDEN_METADATA_KEYS
        }
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    return value


def sanitize_metadata(metadata_json: Optional[str]) -> str:
    if not metadata_json:
        return "{}"
    try:
        return json.dumps(_sanitize_value(json.loads(metadata_json)), ensure_ascii=False)
    except json.JSONDecodeError:
        return "{}"


def _validate_submission_fields(
    title: str,
    description: Optional[str],
    route_id: Optional[str],
    prompt_excerpt: Optional[str],
    allow_public_candidate: bool,
) -> SubmissionCreate:
    try:
        return SubmissionCreate(
            title=title, description=description or None, route_id=route_id or None,
            prompt_excerpt=prompt_excerpt or None, allow_public_candidate=allow_public_candidate,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


def _validate_upload(filename: str, content: bytes) -> str:
    if not filename or len(filename) > MAX_FILENAME_LENGTH:
        raise HTTPException(status_code=400, detail="Invalid filename length")
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename: path traversal not allowed")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_FILE_TYPES:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File {filename} exceeds 8MB limit")
    if ext == ".json":
        try:
            json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail=f"File {filename} contains invalid JSON") from exc
    elif ext == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=400, detail=f"File {filename} content does not match extension {ext}")
    elif ext in {".jpg", ".jpeg"} and not content.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status_code=400, detail=f"File {filename} content does not match extension {ext}")
    elif ext == ".webp" and not (content.startswith(b"RIFF") and b"WEBP" in content[:12]):
        raise HTTPException(status_code=400, detail=f"File {filename} content does not match extension {ext}")
    return ext


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    print(f"[{RUNTIME_NAME}] version={VERSION}")
    print(f"[{RUNTIME_NAME}] storage={'explicit' if expose_storage_paths() else 'private'}")
    if not os.environ.get("PVOS_ADMIN_PASSWORD"):
        print(f"[{RUNTIME_NAME}] WARNING: PVOS_ADMIN_PASSWORD not set. Admin API fails closed.")
    yield


app = FastAPI(
    title=f"{PRODUCT_NAME} API",
    version=VERSION,
    description="Agent-Ready Visual Core + Human Approval Workflow Runtime",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Password", "X-Project-Key"],
)
app.include_router(agent_ready_router)


@app.middleware("http")
async def enforce_public_write_rate_limits(request: Request, call_next):
    """Protect public demo write endpoints without affecting local-first usage."""
    if request.method == "POST" and request.url.path in RATE_LIMIT_DEFAULTS and rate_limit_enabled():
        allowed, limit, remaining, retry_after = _consume_rate_limit(request)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please retry later."},
                headers={"Retry-After": str(retry_after), "X-RateLimit-Limit": str(limit), "X-RateLimit-Remaining": "0"},
            )
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
    return await call_next(request)


@app.middleware("http")
async def add_frontend_no_cache_headers(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path in {"/", "/index.html", "/admin"} or path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-store, max-age=0, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# Runtime and Hosted Lite compatibility -------------------------------------
@app.get("/api/health", response_model=HealthResponse)
def health_check():
    storage = str(DB_PATH) if expose_storage_paths() else "private"
    return HealthResponse(
        status="healthy",
        version=VERSION,
        visual_core_version=VISUAL_CORE_VERSION,
        runtime_build=RUNTIME_BUILD,
        ui_build=UI_BUILD,
        product_name=PRODUCT_NAME,
        timestamp=datetime.now(timezone.utc).isoformat(),
        storage=storage,
    )


@app.get("/api/releases/current", response_model=ReleaseResponse)
def current_release():
    conn = get_db()
    row = conn.execute("SELECT version, release_date, changelog, is_current FROM releases WHERE is_current = 1 LIMIT 1").fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No current release found")
    data = row_to_dict(row)
    data["is_current"] = bool(data["is_current"])
    return ReleaseResponse(**data)


@app.get("/api/library/manifest", response_model=LibraryManifestResponse)
def legacy_library_manifest():
    manifest = get_manifest()
    return LibraryManifestResponse(
        version=VERSION, route_count=manifest["route_count"], component_count=manifest["component_count"],
        font_count=manifest["font_count"], light_count=manifest["component_groups"]["lighting_presets"],
        text_relation_count=manifest["text_relation_count"],
    )


@app.post("/api/events", status_code=201)
def submit_event(event: EventCreate):
    if event.event_name not in ALLOWED_EVENTS:
        raise HTTPException(status_code=400, detail="Invalid event_name")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO events (event_name, session_id, release_version, timestamp, route_id, text_strategy, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (event.event_name, event.session_id, event.release_version, event.timestamp, event.route_id,
         event.text_strategy, sanitize_metadata(event.metadata_json)),
    )
    conn.commit()
    event_id = cursor.lastrowid
    conn.close()
    return {"id": event_id, "status": "recorded"}


@app.post("/api/prompts/compile")
def compile_prompt_public(payload: DirectorConfig):
    """Stateless prompt compilation for the Human-First UI.

    Holds no private data: it reads only the curated visual library and the
    submitted director config, and persists nothing. Private Character and
    Workflow APIs remain behind the project key on /api/v1.
    """
    try:
        return compile_prompt(payload.model_dump())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/feedback", status_code=201)
def submit_feedback(feedback: FeedbackCreate):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO feedback (rating, issue_type, comment, route_id, text_strategy, release_version, session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (feedback.rating, feedback.issue_type, feedback.comment, feedback.route_id, feedback.text_strategy,
         feedback.release_version, feedback.session_id),
    )
    conn.commit()
    feedback_id = cursor.lastrowid
    conn.close()
    return {"id": feedback_id, "status": "submitted"}


@app.post("/api/submissions", status_code=201)
async def create_submission(
    title: str = Form(...), description: Optional[str] = Form(None), route_id: Optional[str] = Form(None),
    prompt_excerpt: Optional[str] = Form(None), allow_public_candidate: bool = Form(False),
    files: List[UploadFile] = File(default=[]),
):
    if is_public_demo():
        raise HTTPException(status_code=403, detail="Public demo mode: submissions and uploads are disabled")
    fields = _validate_submission_fields(title, description, route_id, prompt_excerpt, allow_public_candidate)
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_FILES} files allowed")
    cached = []
    total = 0
    for upload in files:
        filename = upload.filename or ""
        content = await upload.read()
        total += len(content)
        if total > MAX_TOTAL_UPLOAD_SIZE:
            raise HTTPException(status_code=400, detail="Total upload size exceeds 20MB limit")
        ext = _validate_upload(filename, content)
        cached.append((filename, content, ext))

    created_files: List[Path] = []
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO submissions (title, description, route_id, prompt_excerpt, allow_public_candidate, status)
               VALUES (?, ?, ?, ?, ?, 'candidate')""",
            (fields.title, fields.description, fields.route_id, fields.prompt_excerpt, int(fields.allow_public_candidate)),
        )
        submission_id = cursor.lastrowid
        for filename, content, ext in cached:
            stored_name = f"{generate_session_id()}_{int(datetime.now().timestamp())}{ext}"
            file_path = UPLOADS_DIR / stored_name
            file_path.write_bytes(content)
            created_files.append(file_path)
            if file_path.stat().st_size != len(content):
                raise RuntimeError(f"File {filename} write failed")
            cursor.execute(
                """INSERT INTO submission_files (submission_id, original_name, stored_name, file_type, file_size)
                   VALUES (?, ?, ?, ?, ?)""",
                (submission_id, filename, stored_name, ext.lstrip("."), len(content)),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        for file_path in created_files:
            file_path.unlink(missing_ok=True)
        raise
    finally:
        conn.close()
    return {"id": submission_id, "status": "submitted"}


# Admin ---------------------------------------------------------------------
def _admin_or_401(password: Optional[str]) -> None:
    if not require_admin(password):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/api/admin/feedback")
def list_feedback(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), admin_password: Optional[str] = Header(None, alias="X-Admin-Password")):
    _admin_or_401(admin_password)
    conn = get_db()
    rows = conn.execute("SELECT * FROM feedback ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
    conn.close()
    return {"items": [row_to_dict(row) for row in rows], "total": total, "limit": limit, "offset": offset}


@app.get("/api/admin/submissions")
def list_submissions(status: Optional[str] = Query(None, max_length=64), limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), admin_password: Optional[str] = Header(None, alias="X-Admin-Password")):
    _admin_or_401(admin_password)
    conn = get_db()
    if status:
        rows = conn.execute("SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?", (status, limit, offset)).fetchall()
        total = conn.execute("SELECT COUNT(*) FROM submissions WHERE status = ?", (status,)).fetchone()[0]
    else:
        rows = conn.execute("SELECT * FROM submissions ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
        total = conn.execute("SELECT COUNT(*) FROM submissions").fetchone()[0]
    conn.close()
    return {"items": [row_to_dict(row) for row in rows], "total": total, "limit": limit, "offset": offset}


@app.get("/api/admin/submissions/{submission_id}")
def get_submission(submission_id: int, admin_password: Optional[str] = Header(None, alias="X-Admin-Password")):
    _admin_or_401(admin_password)
    conn = get_db()
    submission = conn.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,)).fetchone()
    if not submission:
        conn.close()
        raise HTTPException(status_code=404, detail="Submission not found")
    files = conn.execute("SELECT * FROM submission_files WHERE submission_id = ?", (submission_id,)).fetchall()
    conn.close()
    return {**row_to_dict(submission), "files": [row_to_dict(row) for row in files]}


@app.post("/api/admin/submissions/{submission_id}/review")
def review_submission(submission_id: int, review: ReviewActionCreate, admin_password: Optional[str] = Header(None, alias="X-Admin-Password")):
    _admin_or_401(admin_password)
    conn = get_db()
    if not conn.execute("SELECT 1 FROM submissions WHERE id = ?", (submission_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Submission not found")
    now = datetime.now(timezone.utc).isoformat()
    conn.execute("UPDATE submissions SET status = ?, reviewed_at = ?, reviewer_comment = ? WHERE id = ?", (review.action, now, review.comment, submission_id))
    conn.execute("INSERT INTO review_actions (submission_id, action, comment) VALUES (?, ?, ?)", (submission_id, review.action, review.comment))
    conn.commit()
    conn.close()
    return {"status": "reviewed", "action": review.action}


@app.post("/api/admin/rule-updates/{proposal_id}/review")
def review_rule_update(proposal_id: str, payload: RuleUpdateReview, admin_password: Optional[str] = Header(None, alias="X-Admin-Password")):
    _admin_or_401(admin_password)
    try:
        return agent_commands.review_rule_update(proposal_id, payload.decision, payload.curator_comment)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/admin/stats", response_model=AdminStatsResponse)
def admin_stats(admin_password: Optional[str] = Header(None, alias="X-Admin-Password")):
    _admin_or_401(admin_password)
    conn = get_db()
    cursor = conn.cursor()
    total_events = cursor.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    total_feedback = cursor.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
    total_submissions = cursor.execute("SELECT COUNT(*) FROM submissions").fetchone()[0]
    prompt_copied_count = cursor.execute("SELECT COUNT(*) FROM events WHERE event_name = 'prompt_copied'").fetchone()[0]
    png_exported_count = cursor.execute("SELECT COUNT(*) FROM events WHERE event_name = 'poster_exported'").fetchone()[0]
    route_selection_ranking = {row["route_id"]: row["cnt"] for row in cursor.execute("SELECT route_id, COUNT(*) cnt FROM events WHERE event_name = 'route_selected' AND route_id IS NOT NULL GROUP BY route_id ORDER BY cnt DESC LIMIT 10").fetchall()}
    text_strategy_usage = {row["text_strategy"]: row["cnt"] for row in cursor.execute("SELECT text_strategy, COUNT(*) cnt FROM events WHERE text_strategy IS NOT NULL GROUP BY text_strategy ORDER BY cnt DESC").fetchall()}
    pending_submissions = cursor.execute("SELECT COUNT(*) FROM submissions WHERE status = 'candidate'").fetchone()[0]
    reviewed_submissions = cursor.execute("SELECT COUNT(*) FROM submissions WHERE status != 'candidate'").fetchone()[0]
    conn.close()
    return AdminStatsResponse(
        total_events=total_events, total_feedback=total_feedback, total_submissions=total_submissions,
        prompt_copied_count=prompt_copied_count, png_exported_count=png_exported_count,
        route_selection_ranking=route_selection_ranking, text_strategy_usage=text_strategy_usage,
        pending_submissions=pending_submissions, reviewed_submissions=reviewed_submissions,
    )


@app.get("/admin", include_in_schema=False)
def admin_page():
    path = BASE_DIR / "web" / "admin.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Admin page not found")
    return HTMLResponse(path.read_text(encoding="utf-8"))


web_dir = BASE_DIR / "web"
if web_dir.exists():
    app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("service.main:app", host="127.0.0.1", port=4173, reload=False)
