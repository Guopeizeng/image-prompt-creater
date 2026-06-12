"""Human-readable visual safety and composition warnings."""
from __future__ import annotations
from typing import Any, Dict, List
from .director_config import normalize_text_strategy

def resolve_risks(config: Dict[str, Any], route: dict) -> List[Dict[str, str]]:
    strategy = normalize_text_strategy(config.get("text_strategy"))
    text = " ".join(str(value or "") for value in (config.get("subject_notes"), config.get("extra_request"), config.get("generation_text"), route.get("prompt_core_en"), route.get("summary"))).lower()
    risks: List[Dict[str, str]] = []
    def add(code: str, level: str, reason: str, mitigation: str) -> None: risks.append({"code": code, "level": level, "reason": reason, "mitigation": mitigation})
    if any(word in text for word in ("sunglasses", "dark glasses", "墨镜", "护目镜")):
        add("opaque-eyewear", "warning", "深色镜片可能制造重复眼睛或错误视线。", "不透明镜片必须完整遮挡双眼；若身份辨识依赖眼神，优先改为手持或抬起墨镜。")
    if any(word in text for word in ("glasses", "眼镜", "镜片")):
        add("clear-lens-reflection", "warning", "透明镜片在闪光条件下容易遮挡瞳孔或扭曲眼睛。", "降低镜片反光，保持双眼对齐且可读，不要生成大块白色反射。")
    if strategy in {"poster-layout", "decorative-glyph", "integrated-text", "free-experiment"}:
        add("typography-surface", "info", "文字容器、字形或海报结构将参与底图构成，存在遮挡面部、伪文字或随机品牌字样风险。", "限制为单一用户文案、受控字形纹理或无字海报骨架；正式可读文字进入排版层，并保留脸部避让区。")
    if strategy == "poster-layout" and str(config.get("template_reference_mode") or "recommended") == "recommended":
        add("poster-template-optional", "info", "当前海报骨架可在无模板条件下执行；复杂拼贴、旧刊和多层版式仍可能波动。", "需要更强复现时额外上传一张版式模板图，并将 template_reference_mode 切换为 attached。")
    if strategy == "integrated-text" and not str(config.get("generation_text") or "").strip():
        add("missing-user-copy", "warning", "融合指定文字模式缺少真实文案。", "填写 generation_text，或降级为 reserve-space。")
    if config.get("subject_count", 1) > 2:
        add("multi-face-density", "warning", "多人构图更容易出现面部重叠与手部关系混乱。", "减少动作复杂度，拉开主体层级，优先保证每张脸与关键手势可读。")
    if str(config.get("identity_level", "3")) in {"1", "2"}:
        add("identity-fidelity", "warning", "较低身份保留等级可能损失五官关系。", "客户交付任务建议使用身份保留等级 3 或更高。")
    if not risks:
        add("baseline", "info", "未识别到需要额外降级的显著风险。", "继续保持面部避让、单一光源逻辑与自然动作连续性。")
    return risks
