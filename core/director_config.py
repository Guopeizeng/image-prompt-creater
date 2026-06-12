"""Director config validation shared by UI bridge, HTTP, Skills and workflow commands.

V6.1.0 keeps the Human-First typography participation modes from the V5.13.x
workbench and adds a sixth poster-layout strategy: generate a designed poster
skeleton without burning readable copy into the image. Legacy Agent-Ready
aliases remain accepted so existing runs and API clients do not break.
"""
from __future__ import annotations

from typing import Any, Dict

from .library_loader import get_library, get_route

TEXT_STRATEGY_ALIASES = {
    "no-text": "clean",
    "post-layout": "reserve-space",
}
SUPPORTED_TEXT_STRATEGIES = {
    "clean", "reserve-space", "poster-layout", "decorative-glyph", "integrated-text", "free-experiment",
    *TEXT_STRATEGY_ALIASES,
}
SUPPORTED_TEXT_RELATIONS = {
    "independent-layout", "background-anchor", "interleaved-subject", "subject-mask", "ink-overlay",
}
DEFAULTS: Dict[str, Any] = {
    "subject_count": 1,
    "text_strategy": "reserve-space",
    "text_relation": "independent-layout",
    "identity_level": "1",
    "face_mode": "auto",
    "subject_scale": "auto",
    "outfit_mode": "auto",
    "fusion_mode": "auto",
    "motif_mode": "none",
    "ratio": "4:5",
    "selected_component_ids": [],
    "sync_to_layout": True,
    "provider": "gpt-image",
    "scene_richness": None,
    "template_reference_mode": "recommended",
    "poster_layout_skeleton": None,
}
SUPPORTED_PROVIDERS = {"gpt-image", "doubao-seedream"}
SUPPORTED_SCENE_RICHNESS = {"compact", "standard", "rich"}
SUPPORTED_TEMPLATE_REFERENCE_MODES = {"none", "recommended", "attached"}


ALLOWED_DIRECTOR_CONFIG_FIELDS = set(DEFAULTS) | {
    "route_id", "character_id", "generation_text", "subject_notes", "extra_request",
    "visual_direction_label", "visual_direction_brief",
    "visual_template_id", "template_role_blocking_id", "single_action_blueprint_id",
    "gaze_lock_id", "expression_preset_id", "composition_blueprint_id",
    "template_reference_note",
    "typography_interaction_preset_id", "typography_participation_mode_id",
}


def normalize_text_strategy(value: Any) -> str:
    strategy = str(value or DEFAULTS["text_strategy"]).strip()
    if strategy not in SUPPORTED_TEXT_STRATEGIES:
        raise ValueError(f"unsupported text_strategy: {strategy}")
    return TEXT_STRATEGY_ALIASES.get(strategy, strategy)


def _index(list_name: str, id_key: str = "id") -> dict[str, dict]:
    return {str(item.get(id_key)): item for item in get_library().get(list_name, []) if item.get(id_key)}


def _normalize_optional_text(value: Any, *, field: str, max_length: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) > max_length:
        raise ValueError(f"{field} exceeds max length {max_length}")
    return text


def _normalize_component_ids(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, (list, tuple)):
        raise ValueError("selected_component_ids must be a JSON array")
    result: list[str] = []
    seen: set[str] = set()
    for raw in value:
        item = str(raw or "").strip()
        if not item:
            continue
        if len(item) > 160:
            raise ValueError("selected_component_ids contains an item longer than 160 characters")
        if item not in seen:
            seen.add(item)
            result.append(item)
    if len(result) > 80:
        raise ValueError("selected_component_ids supports at most 80 unique items")
    return result


def validate_director_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Return a normalized, explainable config or raise a stable ValueError."""
    if not isinstance(config, dict):
        raise ValueError("director config must be a JSON object")
    unknown_fields = sorted(set(config) - ALLOWED_DIRECTOR_CONFIG_FIELDS)
    if unknown_fields:
        raise ValueError("unsupported director config field(s): " + ", ".join(unknown_fields))
    route_id = str(config.get("route_id") or "").strip()
    if not route_id:
        raise ValueError("route_id is required")
    route = get_route(route_id)
    normalized = {**DEFAULTS, **config, "route_id": route_id}
    normalized["text_strategy"] = normalize_text_strategy(normalized.get("text_strategy"))
    relation = str(normalized.get("text_relation") or DEFAULTS["text_relation"]).strip()
    if relation not in SUPPORTED_TEXT_RELATIONS:
        raise ValueError(f"unsupported text_relation: {relation}")
    normalized["text_relation"] = relation
    provider = str(normalized.get("provider") or DEFAULTS["provider"]).strip()
    if provider not in SUPPORTED_PROVIDERS:
        raise ValueError(f"unsupported provider: {provider}")
    normalized["provider"] = provider
    template_reference_mode = str(normalized.get("template_reference_mode") or DEFAULTS["template_reference_mode"]).strip()
    if template_reference_mode not in SUPPORTED_TEMPLATE_REFERENCE_MODES:
        raise ValueError(f"unsupported template_reference_mode: {template_reference_mode}")
    normalized["template_reference_mode"] = template_reference_mode
    richness = normalized.get("scene_richness")
    if richness is not None and str(richness).strip() != "":
        richness = str(richness).strip()
        if richness not in SUPPORTED_SCENE_RICHNESS:
            raise ValueError(f"unsupported scene_richness: {richness}")
        normalized["scene_richness"] = richness
    else:
        normalized["scene_richness"] = None
    subject_count = int(normalized.get("subject_count") or 1)
    if subject_count < 1 or subject_count > 8:
        raise ValueError("subject_count must be between 1 and 8")
    normalized["subject_count"] = subject_count
    normalized["selected_component_ids"] = _normalize_component_ids(normalized.get("selected_component_ids"))
    for field, max_length in {
        "character_id": 80,
        "generation_text": 500,
        "subject_notes": 2000,
        "extra_request": 2000,
        "visual_direction_label": 120,
        "visual_direction_brief": 1000,
        "poster_layout_skeleton": 2000,
        "template_reference_note": 1000,
    }.items():
        normalized[field] = _normalize_optional_text(normalized.get(field), field=field, max_length=max_length)
    warnings: list[str] = []
    if normalized["text_strategy"] in {"integrated-text", "free-experiment"} and not str(normalized.get("generation_text") or "").strip():
        warnings.append(f"{normalized['text_strategy']} is enabled but generation_text is empty")
    if normalized["text_strategy"] == "clean" and normalized.get("generation_text"):
        warnings.append("clean mode ignores generation_text in the generated base image")
    if normalized["text_strategy"] == "poster-layout" and normalized.get("generation_text"):
        warnings.append("poster-layout keeps the title editable and uses generation_text only to estimate title length; use integrated-text to render exact copy")
    if normalized["template_reference_mode"] == "attached" and not normalized.get("template_reference_note"):
        warnings.append("attached template reference mode assumes the last uploaded image is a layout reference")

    # Optional parity controls are validated when present, but omitted controls
    # remain route-resolved so API clients can stay intentionally small.
    optional_indexes = {
        "visual_template_id": _index("visual_templates"),
        "template_role_blocking_id": _index("template_role_blockings"),
        "single_action_blueprint_id": _index("single_portrait_action_blueprints"),
        "gaze_lock_id": _index("single_portrait_gaze_locks"),
        "expression_preset_id": _index("single_portrait_expression_presets"),
        "composition_blueprint_id": _index("single_portrait_composition_blueprints"),
        "typography_interaction_preset_id": _index("typography_interaction_presets"),
        "typography_participation_mode_id": _index("typography_participation_modes"),
    }
    for field, index in optional_indexes.items():
        value = normalized.get(field)
        if value is not None:
            value = str(value).strip()
            normalized[field] = value or None
        if value and value not in index:
            warnings.append(f"无法解析可选导演控制：{field}={value}")
    return {
        "valid": True,
        "config": normalized,
        "route": {"route_id": route["id"], "name_zh": route.get("name_zh")},
        "warnings": warnings,
        "text_strategy_contract": {
            "canonical": normalized["text_strategy"],
            "accepted_aliases": TEXT_STRATEGY_ALIASES,
            "supported_modes": sorted(SUPPORTED_TEXT_STRATEGIES - set(TEXT_STRATEGY_ALIASES)),
            "supported_relations": sorted(SUPPORTED_TEXT_RELATIONS),
        },
    }
