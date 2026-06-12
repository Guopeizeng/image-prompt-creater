"""Resolve route-bound visual components with explicit provenance."""

from __future__ import annotations

from typing import Any, Dict, List

from .library_loader import component_index, get_route

_LINK_FIELDS = {
    "scene_preset_ids": "scene_presets",
    "prop_wardrobe_preset_ids": "prop_wardrobe_presets",
    "layout_module_ids": "layout_modules",
    "typography_pack_ids": "typography_packs",
    "lighting_preset_ids": "lighting_presets",
    "action_preset_ids": "action_presets",
}


def resolve_components(route_id: str, selected_component_ids: List[str] | None = None) -> Dict[str, Any]:
    route = get_route(route_id)
    index = component_index()
    linked = route.get("linked_components") or {}
    selected_component_ids = selected_component_ids or []
    resolved = []
    unresolved = []

    def append_component(component_id: str, source: str, expected_group: str | None = None) -> None:
        component = index.get(component_id)
        if not component:
            unresolved.append({"component_id": component_id, "source": source, "expected_group": expected_group})
            return
        resolved.append({
            "component_id": component_id,
            "component_group": component.get("component_group"),
            "name_zh": component.get("name_zh") or component.get("name") or component_id,
            "prompt_en": component.get("prompt_en") or component.get("instruction_en") or component.get("summary_en") or "",
            "source": source,
        })

    for field, group in _LINK_FIELDS.items():
        for component_id in linked.get(field, []) or []:
            append_component(component_id, f"route.linked_components.{field}", group)
    for component_id in selected_component_ids:
        append_component(component_id, "director_config.selected_component_ids")

    # stable de-duplication
    seen = set()
    unique_resolved = []
    for item in resolved:
        if item["component_id"] not in seen:
            seen.add(item["component_id"])
            unique_resolved.append(item)

    return {
        "route_id": route_id,
        "resolved_components": unique_resolved,
        "unresolved_tokens": unresolved,
        "warnings": [
            f"无法解析组件 token：{item['component_id']}" for item in unresolved
        ],
    }
