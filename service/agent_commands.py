"""Persisted Agent command layer for PVOS V5.16.1.

Every human-facing workflow action has a machine-callable equivalent and an
append-only workflow step record. The functions in this file are intentionally
small and explicit so they can be reused by HTTP, Skills, or a future queue worker.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, Optional

from core.layout_planner import create_layout_plan
from core.library_loader import get_route
from core.prompt_compiler import compile_prompt
from core.route_resolver import recommend_routes
from .models import generate_id, get_db, row_to_dict, utc_now

MAX_JSON_BYTES = 32 * 1024


def _json(value: Any, *, max_bytes: int = MAX_JSON_BYTES) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(payload.encode("utf-8")) > max_bytes:
        raise ValueError(f"JSON payload exceeds {max_bytes} bytes")
    return payload


def _decode(raw: Optional[str], fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _fetch_one(query: str, params: Iterable[Any]) -> Optional[dict]:
    conn = get_db()
    row = conn.execute(query, tuple(params)).fetchone()
    conn.close()
    return row_to_dict(row)


def _run(run_id: str) -> dict:
    run = _fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run_id,))
    if not run:
        raise KeyError(f"workflow run not found: {run_id}")
    return run


def record_step(run_id: str, step_type: str, status: str, payload: Dict[str, Any] | None = None) -> dict:
    _run(run_id)
    step_id = generate_id("step")
    now = utc_now()
    conn = get_db()
    conn.execute(
        "INSERT INTO workflow_steps (id, run_id, step_type, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (step_id, run_id, step_type, status, _json(payload or {}), now),
    )
    conn.commit()
    conn.close()
    return {"id": step_id, "run_id": run_id, "step_type": step_type, "status": status, "payload": payload or {}, "created_at": now}


def create_character_profile(data: Dict[str, Any]) -> dict:
    character_id = generate_id("person")
    now = utc_now()
    conn = get_db()
    conn.execute(
        """INSERT INTO characters
           (id, display_name, identity_notes_json, must_preserve_json, multiview_sheet, privacy_scope, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            character_id, data.get("display_name"), _json(data.get("identity_notes") or {}),
            _json(data.get("must_preserve") or []), data.get("multiview_sheet"),
            data.get("privacy_scope", "private"), now, now,
        ),
    )
    conn.commit()
    conn.close()
    return get_character_profile(character_id)


def get_character_profile(character_id: str) -> dict:
    character = _fetch_one("SELECT * FROM characters WHERE id = ?", (character_id,))
    if not character:
        raise KeyError(f"character not found: {character_id}")
    character["identity_notes"] = _decode(character.pop("identity_notes_json", "{}"), {})
    character["must_preserve"] = _decode(character.pop("must_preserve_json", "[]"), [])
    return character


def create_workflow_run(data: Dict[str, Any]) -> dict:
    character_id = data.get("character_id")
    if character_id:
        get_character_profile(character_id)
    run_id = generate_id("run")
    now = utc_now()
    conn = get_db()
    conn.execute(
        """INSERT INTO workflow_runs
           (id, character_id, intent, subject_count, mode, status, text_strategy, director_config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'created', ?, '{}', ?, ?)""",
        (
            run_id, character_id, data.get("intent", ""), data.get("subject_count", 1),
            data.get("mode", "assist"), data.get("text_strategy", "post-layout"), now, now,
        ),
    )
    conn.commit()
    conn.close()
    record_step(run_id, "create_workflow_run", "completed", {"mode": data.get("mode", "assist")})
    return get_workflow_run(run_id)


def get_workflow_run(run_id: str) -> dict:
    run = _run(run_id)
    conn = get_db()
    steps = [row_to_dict(row) for row in conn.execute("SELECT * FROM workflow_steps WHERE run_id = ? ORDER BY created_at, id", (run_id,)).fetchall()]
    artifacts = [row_to_dict(row) for row in conn.execute("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, id", (run_id,)).fetchall()]
    queue_items = [row_to_dict(row) for row in conn.execute("SELECT * FROM generation_queue_items WHERE run_id = ? ORDER BY created_at, queue_id, variant_index", (run_id,)).fetchall()]
    approvals = [row_to_dict(row) for row in conn.execute("SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at, id", (run_id,)).fetchall()]
    feedback = [row_to_dict(row) for row in conn.execute("SELECT * FROM workflow_feedback WHERE run_id = ? ORDER BY created_at, id", (run_id,)).fetchall()]
    proposals = [row_to_dict(row) for row in conn.execute("SELECT * FROM rule_update_proposals WHERE run_id = ? ORDER BY created_at, id", (run_id,)).fetchall()]
    conn.close()
    for step in steps:
        step["payload"] = _decode(step.pop("payload_json", "{}"), {})
    for artifact in artifacts:
        artifact["metadata"] = _decode(artifact.pop("metadata_json", "{}"), {})
        artifact["is_selected"] = bool(artifact["is_selected"])
    for item in queue_items:
        item["director_config"] = _decode(item.pop("director_config_json", "{}"), {})
        item["metadata"] = _decode(item.pop("metadata_json", "{}"), {})
    for item in feedback:
        item["metadata"] = _decode(item.pop("metadata_json", "{}"), {})
    for proposal in proposals:
        proposal["proposed_value"] = _decode(proposal.pop("proposed_value_json", "null"), None)
    run["director_config"] = _decode(run.pop("director_config_json", "{}"), {})
    run["recommended_routes"] = _decode(run.pop("recommended_routes_json", "[]"), [])
    run["layout_plan"] = _decode(run.pop("layout_plan_json", None), None)
    run["steps"] = steps
    run["artifacts"] = artifacts
    run["generation_queue"] = queue_items
    run["approvals"] = approvals
    run["feedback"] = feedback
    run["rule_update_proposals"] = proposals
    return run


def recommend_routes_for_run(run_id: str, limit: int = 3) -> dict:
    run = _run(run_id)
    intent = run.get("intent") or "通用人物肖像"
    results = recommend_routes(intent=intent, subject_count=int(run.get("subject_count") or 1), limit=limit)
    now = utc_now()
    conn = get_db()
    conn.execute(
        "UPDATE workflow_runs SET recommended_routes_json = ?, status = 'routes_recommended', updated_at = ? WHERE id = ?",
        (_json(results), now, run_id),
    )
    conn.commit()
    conn.close()
    record_step(run_id, "recommend_routes", "completed", {"count": len(results), "route_ids": [item["route_id"] for item in results]})
    return {"run_id": run_id, "recommendations": results}


def select_route(run_id: str, route_id: str, comment: Optional[str] = None) -> dict:
    route = get_route(route_id)
    now = utc_now()
    conn = get_db()
    conn.execute("UPDATE workflow_runs SET route_id = ?, status = 'route_selected', updated_at = ? WHERE id = ?", (route_id, now, run_id))
    conn.commit()
    conn.close()
    record_step(run_id, "select_route", "completed", {"route_id": route_id, "name_zh": route.get("name_zh"), "comment": comment})
    return get_workflow_run(run_id)


def approve_gate(run_id: str, gate: str, decision: str, comment: Optional[str], actor: str) -> dict:
    _run(run_id)
    approval_id = generate_id("approval")
    now = utc_now()
    conn = get_db()
    conn.execute(
        "INSERT INTO approvals (id, run_id, gate, decision, comment, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (approval_id, run_id, gate, decision, comment, actor, now),
    )
    if decision == "approved":
        status = {
            "route": "route_approved", "prompt_queue": "prompt_queue_approved", "output": "output_approved",
            "delivery": "delivered", "rule_update": "rule_update_approved",
        }.get(gate, f"{gate}_approved")
    elif decision == "revision_requested":
        status = f"{gate}_revision_requested"
    else:
        status = f"{gate}_rejected"
    conn.execute("UPDATE workflow_runs SET status = ?, updated_at = ? WHERE id = ?", (status, now, run_id))
    conn.commit()
    conn.close()
    record_step(run_id, f"approve_{gate}", decision, {"approval_id": approval_id, "comment": comment, "actor": actor})
    return {"id": approval_id, "run_id": run_id, "gate": gate, "decision": decision, "status": status, "created_at": now}


def is_gate_approved(run_id: str, gate: str) -> bool:
    row = _fetch_one(
        "SELECT decision FROM approvals WHERE run_id = ? AND gate = ? ORDER BY created_at DESC, id DESC LIMIT 1",
        (run_id, gate),
    )
    return bool(row and row["decision"] == "approved")


def compile_prompt_for_run(run_id: str, config: Optional[Dict[str, Any]] = None) -> dict:
    run = _run(run_id)
    if not run.get("route_id"):
        raise ValueError("select a route before compiling a prompt")
    if run.get("mode") != "manual" and not is_gate_approved(run_id, "route"):
        raise PermissionError("route approval is required before prompt compilation")
    merged = {
        "route_id": run["route_id"], "character_id": run.get("character_id"),
        "subject_count": run.get("subject_count", 1), "text_strategy": run.get("text_strategy", "post-layout"),
    }
    merged.update(config or {})
    merged["route_id"] = run["route_id"]  # selected route remains authoritative
    result = compile_prompt(merged)
    now = utc_now()
    conn = get_db()
    conn.execute(
        "UPDATE workflow_runs SET director_config_json = ?, layout_plan_json = ?, status = 'prompt_compiled', updated_at = ? WHERE id = ?",
        (_json(merged), _json(result["layout_plan"]), now, run_id),
    )
    conn.commit()
    conn.close()
    record_step(run_id, "compile_prompt", "completed", {"route_id": run["route_id"], "warnings": result["warnings"]})
    return {"run_id": run_id, **result}


def create_generation_queue(run_id: str, data: Dict[str, Any]) -> dict:
    """Persist provider-neutral queue items after route approval and prompt compilation."""
    run = _run(run_id)
    if run.get("mode") != "manual" and not is_gate_approved(run_id, "route"):
        raise PermissionError("route approval is required before creating a generation queue")
    variants = int(data.get("variants") or 3)
    if variants < 1 or variants > 20:
        raise ValueError("variants must be between 1 and 20")
    provider = str(data.get("provider") or "unassigned").strip()
    if not provider:
        raise ValueError("provider is required")
    config = data.get("director_config") or None
    compiled = compile_prompt_for_run(run_id, config)
    effective_config = _run(run_id).get("director_config_json") or "{}"
    metadata_json = _json(data.get("metadata") or {})
    queue_id = generate_id("queue")
    now = utc_now()
    items = []
    conn = get_db()
    for index in range(1, variants + 1):
        item_id = generate_id("queueitem")
        conn.execute(
            """INSERT INTO generation_queue_items
               (id, queue_id, run_id, provider, variant_index, prompt, director_config_json, status, metadata_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)""",
            (item_id, queue_id, run_id, provider, index, compiled["prompt"], effective_config, metadata_json, now, now),
        )
        items.append({
            "id": item_id, "queue_id": queue_id, "run_id": run_id, "provider": provider,
            "variant_index": index, "status": "queued", "metadata": data.get("metadata") or {},
            "created_at": now, "updated_at": now,
        })
    conn.execute("UPDATE workflow_runs SET status = 'generation_queued', updated_at = ? WHERE id = ?", (now, run_id))
    conn.commit()
    conn.close()
    record_step(run_id, "create_generation_queue", "completed", {"queue_id": queue_id, "provider": provider, "variants": variants})
    return {
        "run_id": run_id, "queue_id": queue_id, "provider": provider, "status": "queued",
        "variant_count": variants, "items": items, "warnings": compiled["warnings"],
    }


def add_artifact(run_id: str, data: Dict[str, Any]) -> dict:
    _run(run_id)
    artifact_id = generate_id("artifact")
    now = utc_now()
    conn = get_db()
    conn.execute(
        "INSERT INTO artifacts (id, run_id, artifact_type, uri, metadata_json, is_selected, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
        (artifact_id, run_id, data["artifact_type"], data["uri"], _json(data.get("metadata") or {}), now),
    )
    conn.execute("UPDATE workflow_runs SET status = 'outputs_recorded', updated_at = ? WHERE id = ?", (now, run_id))
    conn.commit()
    conn.close()
    record_step(run_id, "record_output", "completed", {"artifact_id": artifact_id, "artifact_type": data["artifact_type"]})
    return {"id": artifact_id, "run_id": run_id, "artifact_type": data["artifact_type"], "uri": data["uri"], "metadata": data.get("metadata") or {}, "is_selected": False, "created_at": now}


def select_output(run_id: str, artifact_id: str) -> dict:
    artifact = _fetch_one("SELECT * FROM artifacts WHERE id = ? AND run_id = ?", (artifact_id, run_id))
    if not artifact:
        raise KeyError(f"artifact not found in workflow: {artifact_id}")
    now = utc_now()
    conn = get_db()
    conn.execute("UPDATE artifacts SET is_selected = 0 WHERE run_id = ?", (run_id,))
    conn.execute("UPDATE artifacts SET is_selected = 1 WHERE id = ?", (artifact_id,))
    conn.execute("UPDATE workflow_runs SET selected_output_id = ?, status = 'output_selected', updated_at = ? WHERE id = ?", (artifact_id, now, run_id))
    conn.commit()
    conn.close()
    record_step(run_id, "select_output", "completed", {"artifact_id": artifact_id})
    return get_workflow_run(run_id)


def create_layout_plan_for_run(run_id: str) -> dict:
    run = _run(run_id)
    if not run.get("route_id"):
        raise ValueError("select a route before creating a layout plan")
    config = _decode(run.get("director_config_json"), {})
    config.setdefault("route_id", run["route_id"])
    config.setdefault("text_strategy", run.get("text_strategy", "post-layout"))
    plan = create_layout_plan(config, get_route(run["route_id"]))
    now = utc_now()
    conn = get_db()
    conn.execute("UPDATE workflow_runs SET layout_plan_json = ?, status = 'layout_planned', updated_at = ? WHERE id = ?", (_json(plan), now, run_id))
    conn.commit()
    conn.close()
    record_step(run_id, "create_layout_plan", "completed", {"text_strategy": plan["text_strategy"]})
    return {"run_id": run_id, "layout_plan": plan}


def record_workflow_feedback(run_id: str, data: Dict[str, Any]) -> dict:
    _run(run_id)
    feedback_id = generate_id("feedback")
    now = utc_now()
    conn = get_db()
    conn.execute(
        "INSERT INTO workflow_feedback (id, run_id, rating, comment, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (feedback_id, run_id, data["rating"], data.get("comment"), _json(data.get("metadata") or {}), now),
    )
    conn.commit()
    conn.close()
    record_step(run_id, "record_feedback", "completed", {"feedback_id": feedback_id, "rating": data["rating"]})
    return {"id": feedback_id, "run_id": run_id, "rating": data["rating"], "comment": data.get("comment"), "metadata": data.get("metadata") or {}, "created_at": now}


def propose_rule_update(run_id: str, data: Dict[str, Any]) -> dict:
    _run(run_id)
    proposal_id = generate_id("rule")
    now = utc_now()
    conn = get_db()
    conn.execute(
        """INSERT INTO rule_update_proposals
           (id, run_id, rule_key, proposed_value_json, rationale, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'proposed', ?)""",
        (proposal_id, run_id, data["rule_key"], _json(data.get("proposed_value")), data["rationale"], now),
    )
    conn.commit()
    conn.close()
    record_step(run_id, "propose_rule_update", "completed", {"proposal_id": proposal_id, "rule_key": data["rule_key"]})
    return {"id": proposal_id, "run_id": run_id, "rule_key": data["rule_key"], "proposed_value": data.get("proposed_value"), "rationale": data["rationale"], "status": "proposed", "created_at": now}


def review_rule_update(proposal_id: str, decision: str, curator_comment: Optional[str]) -> dict:
    proposal = _fetch_one("SELECT * FROM rule_update_proposals WHERE id = ?", (proposal_id,))
    if not proposal:
        raise KeyError(f"rule update proposal not found: {proposal_id}")
    now = utc_now()
    conn = get_db()
    conn.execute(
        "UPDATE rule_update_proposals SET status = ?, curator_comment = ?, reviewed_at = ? WHERE id = ?",
        (decision, curator_comment, now, proposal_id),
    )
    conn.commit()
    conn.close()
    record_step(proposal["run_id"], "curator_review_rule_update", decision, {"proposal_id": proposal_id, "comment": curator_comment})
    return {"id": proposal_id, "run_id": proposal["run_id"], "status": decision, "curator_comment": curator_comment, "reviewed_at": now}


COMMAND_REGISTRY = [
    "create_character_profile", "recommend_routes", "resolve_components", "compile_prompt",
    "create_generation_queue", "record_output", "select_output", "create_layout_plan",
    "record_feedback", "propose_rule_update", "approve_route", "approve_prompt_queue",
    "approve_output", "approve_delivery", "curator_review_rule_update",
]
