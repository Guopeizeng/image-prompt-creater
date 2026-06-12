"""Create explainable post-layout plans without rendering pixels."""
from __future__ import annotations
from typing import Any, Dict, List
from .director_config import normalize_text_strategy

_RELATION_EXPLANATION = {
    "independent-layout": "标题作为独立排版层存在，保留呼吸空间。",
    "background-anchor": "标题作为人物轮廓后方的大型背景锚点，避让脸颈与关键手势。",
    "interleaved-subject": "标题与人物轮廓形成受控前后穿插，完整主脸必须可读。",
    "subject-mask": "标题可作为镂空容器，但必须保留一张完整可辨认主脸。",
    "ink-overlay": "标题作为墨迹覆盖层，可跨衣物与背景，但保护眼睛、鼻梁与嘴部。",
}

def create_layout_plan(config: Dict[str, Any], route: dict | None = None) -> Dict[str, Any]:
    strategy = normalize_text_strategy(config.get("text_strategy"))
    relation = config.get("text_relation", "independent-layout")
    ratio = config.get("ratio", "4:5")
    route = route or {}
    title = config.get("generation_text") or ""
    template_reference_mode = config.get("template_reference_mode", "recommended")
    poster_layout_skeleton = config.get("poster_layout_skeleton") or ""
    zones: List[Dict[str, Any]] = [
        {"id": "face-neck-protected", "role": "protected", "avoid": True, "reason": "标题、标签、印章不得遮挡人物面部与颈部关系"},
        {"id": "active-hand-protected", "role": "protected", "avoid": True, "reason": "动作叙事依赖手势时，保留关键手部可读性"},
        {"id": "masthead", "role": "primary-text", "preferred": True, "reason": "优先在低信息密度留白区放置主标题"},
        {"id": "bottom-caption-band", "role": "micro-copy", "preferred": True, "reason": "辅助信息与人物主体分离"},
    ]
    if strategy in {"poster-layout", "integrated-text", "decorative-glyph", "free-experiment"}:
        zones.extend([
            {"id": "headline-container", "role": "editable-poster-structure", "preferred": True, "reason": "建立可见海报骨架，但不在底图渲染真实文字或伪文字"},
            {"id": "supporting-graphic-blocks", "role": "editable-poster-structure", "preferred": True, "reason": "使用一到两个辅助色块、边界线或图层关系强化海报秩序"},
        ])
    return {
        "route_id": route.get("id") or config.get("route_id"),
        "ratio": ratio,
        "text_strategy": strategy,
        "text_relation": relation,
        "title": title,
        "sync_to_layout": bool(config.get("sync_to_layout", True)),
        "template_reference_mode": template_reference_mode,
        "poster_layout_skeleton": poster_layout_skeleton or None,
        "zones": zones,
        "rules": [
            "可读文字不得遮挡眼睛、鼻梁、嘴部、颈部与关键手势",
            "主标题最多保留一个视觉中心",
            "底图阶段的文字参与方式与最终可编辑排版层必须分别记录",
            "输出前必须由人类确认脸部避让区、文字层级与真实文案准确性",
            "海报骨架模式可以生成标题容器、信息带与辅助图层，但不得生成随机伪文字",
            "如附带模板图，只提取版式骨架、主体锚点、留白与材质节奏，不复制示例文字和人物",
        ],
        "explanation": f"{_RELATION_EXPLANATION.get(relation, _RELATION_EXPLANATION['independent-layout'])} 当前文字策略：{strategy}；版式参考图规则：{template_reference_mode}。",
    }
