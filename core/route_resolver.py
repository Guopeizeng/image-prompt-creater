"""Explainable route recommendation for PVOS."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .library_loader import get_library

# Deliberately small, inspectable signal dictionary. It is a stable baseline for
# future learned ranking rather than a hidden black box.
_SIGNAL_GROUPS = {
    "wedding": ["婚礼", "婚纱", "结婚", "couple", "wedding", "亲密", "情侣", "双人"],
    "music": ["巡演", "音乐", "乐队", "吉他", "music", "tour", "indie", "live"],
    "campus": ["校园", "毕业", "青春", "操场", "教室", "campus", "graduation", "school"],
    "street": ["街头", "港风", "夜市", "霓虹", "street", "hong kong", "hk", "urban"],
    "editorial": ["杂志", "封面", "时尚", "editorial", "magazine", "cover", "fashion"],
    "archive": ["档案", "纪实", "黑白", "archival", "documentary", "black and white"],
    "eastern": ["东方", "中式", "传统", "水墨", "chinese", "oriental", "ink"],
    "daily": ["日常", "生活方式", "通勤", "室内", "lifestyle", "daily", "transit"],
}


def _tokens(text: str) -> List[str]:
    text = text.lower()
    latin = re.findall(r"[a-z0-9_-]+", text)
    cjk_sequences = re.findall(r"[\u4e00-\u9fff]+", text)
    cjk_tokens: List[str] = []
    for seq in cjk_sequences:
        if len(seq) >= 2:
            cjk_tokens.append(seq)
        for width in (2, 3, 4):
            cjk_tokens.extend(seq[index:index + width] for index in range(max(0, len(seq) - width + 1)))
    return latin + cjk_tokens


def _route_haystack(route: dict) -> str:
    return " ".join(
        str(route.get(key, ""))
        for key in ("id", "name_zh", "category", "subcategory", "summary", "prompt_core_en")
    ).lower()


def recommend_routes(
    intent: str,
    subject_count: int = 1,
    gender_scope: Optional[str] = None,
    limit: int = 3,
) -> List[Dict[str, Any]]:
    intent_lower = intent.lower().strip()
    tokens = _tokens(intent_lower)
    active_groups = {
        group: [signal for signal in signals if signal.lower() in intent_lower]
        for group, signals in _SIGNAL_GROUPS.items()
    }
    active_groups = {group: signals for group, signals in active_groups.items() if signals}

    scored: List[Dict[str, Any]] = []
    for route in get_library().get("styles", []):
        haystack = _route_haystack(route)
        score = 0.0
        matched: List[str] = []
        for token in tokens:
            if len(token) >= 2 and token in haystack:
                score += 1.6
                matched.append(token)
        for group, signals in active_groups.items():
            route_matches = [s for s in _SIGNAL_GROUPS[group] if s.lower() in haystack]
            if route_matches:
                score += 4.0 + min(len(route_matches), 3) * 0.8
                matched.append(f"signal:{group}")
        architecture = route.get("architecture") or {}
        if architecture.get("server_ready"):
            score += 1.0
            matched.append("server-ready")
        if route.get("ui_priority") in {"V3 核心库", "扩展风格库"}:
            score += 0.4
        scope = str(route.get("gender_scope", "通用"))
        if gender_scope and gender_scope in scope:
            score += 0.7
        # Use route templates as a weak signal for subject count.
        templates = [
            tpl for tpl in get_library().get("visual_templates", [])
            if tpl.get("route_id") == route.get("id") and tpl.get("subject_count") == subject_count
        ]
        if templates:
            score += 1.2
            matched.append(f"subject-count:{subject_count}")
        if score <= 0:
            # Stable fallback allows recommendation even for open-ended requests.
            score = 0.05 if route.get("source_origin") == "v5-integrated" else 0.01
        scored.append({
            "route_id": route["id"],
            "name_zh": route.get("name_zh"),
            "category": route.get("category"),
            "subcategory": route.get("subcategory"),
            "summary": route.get("summary"),
            "score": round(score, 3),
            "matched_signals": sorted(set(matched)),
            "why": _explain(route, active_groups, matched, subject_count),
        })

    scored.sort(key=lambda item: (-item["score"], item["route_id"]))
    return scored[:limit]


def _explain(route: dict, active_groups: dict, matched: List[str], subject_count: int) -> List[str]:
    reasons = []
    if active_groups:
        reasons.append("需求文本命中了可解释场景信号：" + "、".join(active_groups.keys()))
    if any(item.startswith("subject-count:") for item in matched):
        reasons.append(f"该路线存在适配 {subject_count} 人主体的视觉模板")
    if route.get("summary"):
        reasons.append(f"路线摘要与任务方向一致：{route['summary']}")
    if not reasons:
        reasons.append("作为稳定候选路线返回，等待人类导演进一步确认")
    return reasons
