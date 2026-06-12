"""HTTP adapter for the V5.16.1 Visual Core and persisted workflow command layer."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from core.component_resolver import resolve_components
from core.director_config import validate_director_config
from core.layout_planner import create_layout_plan
from core.library_loader import LibraryError, get_manifest, get_route
from core.prompt_compiler import compile_prompt
from core.route_resolver import recommend_routes
from . import agent_commands as commands
from .schemas import (
    ApprovalCreate, ArtifactCreate, CharacterCreate, DirectorConfig, GenerationQueueCreate, OutputSelectionRequest,
    RouteRecommendationRequest, RouteSelectionRequest, RuleUpdateProposalCreate,
    RuleUpdateReview, WorkflowCreate, WorkflowFeedbackCreate,
)

router = APIRouter(prefix="/api/v1", tags=["agent-ready-v1"])


def require_project_key(project_key: Optional[str] = Header(None, alias="X-Project-Key")) -> None:
    expected = os.environ.get("PVOS_PROJECT_KEY")
    if not expected or not project_key or project_key != expected:
        raise HTTPException(status_code=401, detail="Project key required")


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, (ValueError, LibraryError)):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail="Internal command failure")


@router.get("/commands")
def command_registry(_: None = Depends(require_project_key)):
    return {"commands": commands.COMMAND_REGISTRY}


@router.get("/library/manifest")
def library_manifest():
    return get_manifest()


@router.get("/routes/{route_id}")
def route_detail(route_id: str):
    try:
        return get_route(route_id)
    except Exception as exc:
        raise _translate(exc)


@router.post("/routes/recommend")
def route_recommendation(payload: RouteRecommendationRequest, _: None = Depends(require_project_key)):
    return {"recommendations": recommend_routes(**payload.model_dump())}


@router.post("/components/resolve")
def component_resolution(payload: DirectorConfig, _: None = Depends(require_project_key)):
    try:
        return resolve_components(payload.route_id, payload.selected_component_ids)
    except Exception as exc:
        raise _translate(exc)


@router.post("/configs/validate")
def director_config_validation(payload: DirectorConfig, _: None = Depends(require_project_key)):
    try:
        return validate_director_config(payload.model_dump())
    except Exception as exc:
        raise _translate(exc)


@router.post("/prompts/compile")
def prompt_compilation(payload: DirectorConfig, _: None = Depends(require_project_key)):
    try:
        return compile_prompt(payload.model_dump())
    except Exception as exc:
        raise _translate(exc)


@router.post("/layout-plans")
def layout_plan(payload: DirectorConfig, _: None = Depends(require_project_key)):
    try:
        return create_layout_plan(payload.model_dump(), get_route(payload.route_id))
    except Exception as exc:
        raise _translate(exc)


@router.post("/characters", status_code=201)
def create_character(payload: CharacterCreate, _: None = Depends(require_project_key)):
    try:
        return commands.create_character_profile(payload.model_dump())
    except Exception as exc:
        raise _translate(exc)


@router.get("/characters/{character_id}")
def get_character(character_id: str, _: None = Depends(require_project_key)):
    try:
        return commands.get_character_profile(character_id)
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows", status_code=201)
def create_workflow(payload: WorkflowCreate, _: None = Depends(require_project_key)):
    try:
        return commands.create_workflow_run(payload.model_dump())
    except Exception as exc:
        raise _translate(exc)


@router.get("/workflows/{run_id}")
def get_workflow(run_id: str, _: None = Depends(require_project_key)):
    try:
        return commands.get_workflow_run(run_id)
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows/{run_id}/recommend-routes")
def recommend_workflow_routes(run_id: str, _: None = Depends(require_project_key)):
    try:
        return commands.recommend_routes_for_run(run_id)
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows/{run_id}/select-route")
def select_workflow_route(run_id: str, payload: RouteSelectionRequest, _: None = Depends(require_project_key)):
    try:
        return commands.select_route(run_id, payload.route_id, payload.comment)
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows/{run_id}/approvals", status_code=201)
def approve_workflow_gate(run_id: str, payload: ApprovalCreate, _: None = Depends(require_project_key)):
    try:
        return commands.approve_gate(run_id, payload.gate, payload.decision, payload.comment, payload.actor)
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows/{run_id}/compile-prompt")
def compile_workflow_prompt(run_id: str, payload: Optional[DirectorConfig] = None, _: None = Depends(require_project_key)):
    try:
        return commands.compile_prompt_for_run(run_id, payload.model_dump(exclude_unset=True) if payload else None)
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows/{run_id}/generation-queue", status_code=201)
def create_workflow_generation_queue(run_id: str, payload: GenerationQueueCreate, _: None = Depends(require_project_key)):
    try:
        return commands.create_generation_queue(run_id, payload.model_dump(exclude_none=True))
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows/{run_id}/artifacts", status_code=201)
def create_artifact(run_id: str, payload: ArtifactCreate, _: None = Depends(require_project_key)):
    try:
        return commands.add_artifact(run_id, payload.model_dump())
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows/{run_id}/select-output")
def select_workflow_output(run_id: str, payload: OutputSelectionRequest, _: None = Depends(require_project_key)):
    try:
        return commands.select_output(run_id, payload.artifact_id)
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows/{run_id}/layout-plan")
def create_workflow_layout_plan(run_id: str, _: None = Depends(require_project_key)):
    try:
        return commands.create_layout_plan_for_run(run_id)
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows/{run_id}/feedback", status_code=201)
def create_workflow_feedback(run_id: str, payload: WorkflowFeedbackCreate, _: None = Depends(require_project_key)):
    try:
        return commands.record_workflow_feedback(run_id, payload.model_dump())
    except Exception as exc:
        raise _translate(exc)


@router.post("/workflows/{run_id}/rule-updates", status_code=201)
def create_rule_update(run_id: str, payload: RuleUpdateProposalCreate, _: None = Depends(require_project_key)):
    try:
        return commands.propose_rule_update(run_id, payload.model_dump())
    except Exception as exc:
        raise _translate(exc)
