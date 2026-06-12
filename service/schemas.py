"""Pydantic request and response schemas for Hosted Lite and Agent-Ready APIs."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


# Hosted Lite foundation -----------------------------------------------------
class EventCreate(BaseModel):
    event_name: str = Field(..., min_length=1, max_length=64)
    session_id: str = Field(..., min_length=1, max_length=128)
    release_version: Optional[str] = Field(None, max_length=32)
    timestamp: str = Field(..., min_length=1, max_length=64)
    route_id: Optional[str] = Field(None, max_length=160)
    text_strategy: Optional[str] = Field(None, max_length=64)
    metadata_json: Optional[str] = Field(None, max_length=32768)


class FeedbackCreate(BaseModel):
    rating: str = Field(..., pattern="^(close|usable|dissatisfied)$")
    issue_type: Optional[str] = Field(None, pattern="^(route|prompt|typography|discoverability|export|other)$")
    comment: Optional[str] = Field(None, max_length=4000)
    route_id: Optional[str] = Field(None, max_length=160)
    text_strategy: Optional[str] = Field(None, max_length=64)
    release_version: Optional[str] = Field(None, max_length=32)
    session_id: Optional[str] = Field(None, max_length=128)


class SubmissionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    route_id: Optional[str] = Field(None, max_length=160)
    prompt_excerpt: Optional[str] = Field(None, max_length=500)
    allow_public_candidate: bool = False


class ReviewActionCreate(BaseModel):
    action: str = Field(..., pattern="^(strengthen-route|add-component|new-route|reject|hold)$")
    comment: Optional[str] = Field(None, max_length=1000)


class ReleaseResponse(BaseModel):
    version: str
    release_date: str
    changelog: Optional[str]
    is_current: bool


class LibraryManifestResponse(BaseModel):
    version: str
    route_count: int
    component_count: int
    font_count: int
    light_count: int
    text_relation_count: int


class HealthResponse(BaseModel):
    status: str
    version: str
    visual_core_version: str
    runtime_build: str
    ui_build: str
    product_name: str
    timestamp: str
    storage: str


class AdminStatsResponse(BaseModel):
    total_events: int
    total_feedback: int
    total_submissions: int
    prompt_copied_count: int
    png_exported_count: int
    route_selection_ranking: dict
    text_strategy_usage: dict
    pending_submissions: int
    reviewed_submissions: int


# Visual Core ---------------------------------------------------------------
class RouteRecommendationRequest(BaseModel):
    intent: str = Field(..., min_length=1, max_length=1000)
    subject_count: int = Field(1, ge=1, le=8)
    gender_scope: Optional[str] = Field(None, max_length=32)
    limit: int = Field(3, ge=1, le=10)


class DirectorConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    route_id: str = Field(..., min_length=1, max_length=160)
    character_id: Optional[str] = Field(None, max_length=80)
    subject_count: int = Field(1, ge=1, le=8)
    provider: Literal["gpt-image", "doubao-seedream"] = "gpt-image"
    scene_richness: Optional[Literal["compact", "standard", "rich"]] = None
    template_reference_mode: Literal["none", "recommended", "attached"] = "recommended"
    template_reference_note: Optional[str] = Field(None, max_length=1000)
    poster_layout_skeleton: Optional[str] = Field(None, max_length=2000)
    text_strategy: Literal["clean", "reserve-space", "poster-layout", "decorative-glyph", "integrated-text", "free-experiment", "no-text", "post-layout"] = "reserve-space"
    text_relation: Literal["independent-layout", "background-anchor", "interleaved-subject", "subject-mask", "ink-overlay"] = "independent-layout"
    sync_to_layout: bool = True
    identity_level: str = Field("1", max_length=16)
    face_mode: str = Field("auto", max_length=64)
    subject_scale: str = Field("auto", max_length=64)
    outfit_mode: str = Field("auto", max_length=64)
    fusion_mode: str = Field("auto", max_length=64)
    motif_mode: str = Field("none", max_length=64)
    ratio: str = Field("4:5", max_length=16)
    generation_text: Optional[str] = Field(None, max_length=500)
    subject_notes: Optional[str] = Field(None, max_length=2000)
    extra_request: Optional[str] = Field(None, max_length=2000)
    visual_direction_label: Optional[str] = Field(None, max_length=120)
    visual_direction_brief: Optional[str] = Field(None, max_length=1000)
    selected_component_ids: List[str] = Field(default_factory=list, max_length=80)
    visual_template_id: Optional[str] = Field(None, max_length=160)
    template_role_blocking_id: Optional[str] = Field(None, max_length=160)
    single_action_blueprint_id: Optional[str] = Field(None, max_length=160)
    gaze_lock_id: Optional[str] = Field(None, max_length=160)
    expression_preset_id: Optional[str] = Field(None, max_length=160)
    composition_blueprint_id: Optional[str] = Field(None, max_length=160)
    typography_interaction_preset_id: Optional[str] = Field(None, max_length=160)
    typography_participation_mode_id: Optional[str] = Field(None, max_length=160)


class CharacterCreate(BaseModel):
    display_name: Optional[str] = Field(None, max_length=120)
    identity_notes: Dict[str, Any] = Field(default_factory=dict)
    must_preserve: List[str] = Field(default_factory=list, max_length=30)
    multiview_sheet: Optional[str] = Field(None, max_length=500)
    privacy_scope: Literal["private", "project"] = "private"


class WorkflowCreate(BaseModel):
    character_id: Optional[str] = Field(None, max_length=80)
    intent: str = Field("", max_length=1000)
    subject_count: int = Field(1, ge=1, le=8)
    mode: Literal["manual", "assist", "auto"] = "assist"
    text_strategy: Literal["clean", "reserve-space", "poster-layout", "decorative-glyph", "integrated-text", "free-experiment", "no-text", "post-layout"] = "reserve-space"


class RouteSelectionRequest(BaseModel):
    route_id: str = Field(..., min_length=1, max_length=160)
    comment: Optional[str] = Field(None, max_length=1000)


class ApprovalCreate(BaseModel):
    gate: Literal["route", "prompt_queue", "output", "delivery", "rule_update"]
    decision: Literal["approved", "rejected", "revision_requested"]
    comment: Optional[str] = Field(None, max_length=2000)
    actor: str = Field("human", max_length=120)


class ArtifactCreate(BaseModel):
    artifact_type: Literal["reference", "generated_image", "layout_preview", "final_png", "json", "other"]
    uri: str = Field(..., min_length=1, max_length=1000)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class GenerationQueueCreate(BaseModel):
    provider: str = Field("unassigned", min_length=1, max_length=120)
    variants: int = Field(3, ge=1, le=20)
    director_config: Optional[DirectorConfig] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class OutputSelectionRequest(BaseModel):
    artifact_id: str = Field(..., min_length=1, max_length=80)


class WorkflowFeedbackCreate(BaseModel):
    rating: Literal["close", "usable", "dissatisfied"]
    comment: Optional[str] = Field(None, max_length=4000)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RuleUpdateProposalCreate(BaseModel):
    rule_key: str = Field(..., min_length=1, max_length=200)
    proposed_value: Any
    rationale: str = Field(..., min_length=1, max_length=4000)


class RuleUpdateReview(BaseModel):
    decision: Literal["approved", "rejected"]
    curator_comment: Optional[str] = Field(None, max_length=2000)
