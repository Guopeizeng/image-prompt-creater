"""Load and validate the canonical PVOS visual library."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable

from service.settings import LIBRARY_PATH

_COMPONENT_GROUPS = (
    "scene_presets", "prop_wardrobe_presets", "layout_modules",
    "typography_packs", "lighting_presets", "action_presets",
)


class LibraryError(RuntimeError):
    pass


def _unique_ids(items: Iterable[dict], label: str, id_key: str = "id") -> None:
    seen = set()
    duplicates = set()
    for item in items:
        item_id = item.get(id_key)
        if not item_id:
            raise LibraryError(f"{label} contains item without {id_key}")
        if item_id in seen:
            duplicates.add(item_id)
        seen.add(item_id)
    if duplicates:
        raise LibraryError(f"{label} duplicate ids: {sorted(duplicates)[:10]}")


def _component_count(library: Dict[str, Any]) -> int:
    return sum(len(library.get("components", {}).get(group, [])) for group in _COMPONENT_GROUPS)


def validate_library(library: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(library, dict):
        raise LibraryError("canonical library must be a JSON object")
    styles = library.get("styles")
    components = library.get("components")
    if not isinstance(styles, list) or not isinstance(components, dict):
        raise LibraryError("canonical library requires styles[] and components{}")
    _unique_ids(styles, "styles")
    for group in _COMPONENT_GROUPS:
        items = components.get(group, [])
        if not isinstance(items, list):
            raise LibraryError(f"components.{group} must be a list")
        _unique_ids(items, f"components.{group}")
    for list_name in (
        "visual_templates", "template_role_blockings", "route_motion_grammars",
        "single_portrait_action_blueprints", "single_portrait_composition_blueprints",
        "typography_interaction_presets", "font_assets",
    ):
        items = library.get(list_name, [])
        if isinstance(items, list):
            _unique_ids(items, list_name, "route_id" if list_name == "route_motion_grammars" else "id")
    return library


@lru_cache(maxsize=1)
def get_library() -> Dict[str, Any]:
    if not LIBRARY_PATH.exists():
        raise LibraryError(f"canonical library not found: {LIBRARY_PATH}")
    try:
        library = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LibraryError(f"canonical library invalid JSON: {exc}") from exc
    return validate_library(library)


def reload_library() -> Dict[str, Any]:
    get_library.cache_clear()
    return get_library()


def route_index() -> Dict[str, dict]:
    return {route["id"]: route for route in get_library().get("styles", [])}


def component_index() -> Dict[str, dict]:
    result: Dict[str, dict] = {}
    for group in _COMPONENT_GROUPS:
        for item in get_library().get("components", {}).get(group, []):
            result[item["id"]] = {**item, "component_group": group}
    return result


def get_route(route_id: str) -> dict:
    route = route_index().get(route_id)
    if not route:
        raise KeyError(f"route not found: {route_id}")
    return route


def get_manifest() -> Dict[str, Any]:
    library = get_library()
    groups = {group: len(library.get("components", {}).get(group, [])) for group in _COMPONENT_GROUPS}
    return {
        "runtime_schema_version": library.get("runtime_schema_version"),
        "library_schema_version": library.get("library_schema_version"),
        "library_title_zh": library.get("library_title_zh"),
        "route_count": len(library.get("styles", [])),
        "component_count": _component_count(library),
        "component_groups": groups,
        "visual_template_count": len(library.get("visual_templates", [])),
        "role_blocking_count": len(library.get("template_role_blockings", [])),
        "action_blueprint_count": len(library.get("single_portrait_action_blueprints", [])),
        "composition_blueprint_count": len(library.get("single_portrait_composition_blueprints", [])),
        "typography_interaction_count": len(library.get("typography_interaction_presets", [])),
        "font_count": len(library.get("font_assets", [])),
        "text_relation_count": len(library.get("typography_relation_patterns", [])),
        "canonical_path": LIBRARY_PATH.name,
    }
