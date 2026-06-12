"""PVOS V5.16.1 Human-First parity Prompt Compiler.

The compiler remains deterministic and provider-neutral. It mirrors the mature
Human-First workbench channels instead of emitting the deliberately reduced
previous reduced sidecar prompt.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from .component_resolver import resolve_components
from .director_config import normalize_text_strategy, validate_director_config
from .layout_planner import create_layout_plan
from .library_loader import get_library, get_route
from .provider_profiles import get_profile, resolve_scene_richness
from .risk_resolver import resolve_risks

_IDENTITY = {
    "1": "Preserve facial identity with maximum fidelity, including facial geometry, distinctive traits, age impression, gaze, mouth expression, and hairstyle silhouette.",
    "2": "Keep the subject highly recognizable. Allow only light softening while preserving defining facial features.",
    "3": "Preserve face shape, gaze, mouth expression, hairstyle silhouette, and key traits. Allow controlled texture translation.",
    "4": "Keep defining face shape, gaze, hairstyle, and recognizable traits while allowing a clearly stylized graphic translation.",
    "5": "Use a strong illustrative translation while retaining the most distinctive identity cues.",
}
_SCALE = {
    "auto": "Choose a subject scale that serves the selected route while preserving clear recognizability.",
    "close": "Use a face-dominant crop, roughly 55%–80% of the composition, while preserving complete facial landmarks and natural breathing room.",
    "medium": "Use a readable medium portrait or half-body composition, roughly 35%–55% of the frame, with enough body language and environmental context to make staging feel authored.",
    "narrative-readable": "Use a narrative composition with a recognizable person occupying roughly 25%–35% of the frame.",
    "small": "Use a small human anchor only when the environment is the main narrative. Keep the person intentionally readable.",
    "full": "Use a full-body or near-full-body scale with coherent weight distribution, grounded feet, readable hands, and scene depth.",
}
_FACE = {
    "auto": "Choose the facial rendering method that best matches the selected route. Keep at least one complete readable face.",
    "photo": "Keep the face photographic with realistic skin texture and natural expression.",
    "soft": "Retain a photographic face while gently softening skin texture, edges, and local contrast.",
    "editorial": "Use an editorial translation with controlled grain, halftone, paper texture, or restrained color blocking.",
    "graphic": "Translate the face into the same graphic system as the composition.",
    "fragments": "Allow controlled facial fragments, but keep one complete readable face.",
    "engrave": "Translate the face through engraving, cross-hatching, carved lines, or print texture.",
    "paint": "Render the face in a coherent painterly language with shared brushwork and light.",
    "editorial-natural": "Keep skin texture, facial volume, alive eye focus, relaxed mouth relationship, and age impression natural. Avoid plastic retouching and frozen expression.",
    "documentary": "Preserve small asymmetries, lived-in skin texture, and emotionally believable expression. Avoid beauty-filter flattening, vacant gaze, and stiff mouth corners.",
    "polished": "Use restrained editorial polish while keeping the uploaded subject recognizably real.",
    "1": "Keep the face photographic with realistic skin texture and natural expression.",
    "2": "Retain a photographic face while gently softening skin texture, edges, and local contrast.",
    "3": "Use an editorial translation with controlled grain, halftone, paper texture, or restrained color blocking.",
    "4": "Translate the face into the same graphic system as the composition.",
    "5": "Render the face in a coherent painterly language with shared brushwork and light.",
}
_WARDROBE = {
    "auto": "Automatically redesign or restyle the wardrobe so it belongs naturally to the selected route.",
    "redesign": "Completely redesign the wardrobe to match the selected visual route.",
    "restyle": "Preserve the clothing category but redesign color, fabric, silhouette, and layering.",
    "preserve": "Preserve the original wardrobe as much as possible while harmonizing light and material.",
    "graphic": "Translate wardrobe into the same graphic, printed, illustrative, or collage material language.",
    "route-redesign": "Treat original clothing as staging material. Redesign wardrobe, accessories, and silhouette so they belong naturally to the selected visual route.",
}
_FUSION = {
    "auto": "Choose the most suitable subject–world fusion method. The person and background must look authored together, never pasted together.",
    "photo": "Unify subject and environment through light direction, color temperature, shadows, depth, atmosphere, and lens character.",
    "editorial": "Unify portrait, wardrobe, props, and background through shared grain, tonal compression, edge sharpness, and editorial hierarchy.",
    "collage": "Place face, hair, wardrobe, props, and background inside the same paper, torn-edge, photocopy, or magazine-fragment logic.",
    "graphic": "Translate face, hair, wardrobe, props, and background into one coherent graphic system.",
    "paint": "Use one coherent painterly world with shared brushwork, softened edges, luminous light, and consistent depth.",
    "natural": "Embed the subject physically into the world through source-consistent shadow, reflected light, material contact, perspective, and environmental color spill. Avoid a pasted cutout look.",
}
_MOTIF = {
    "none": "Do not add extra symbolic props unless a single object clearly improves the route.",
    "rose": "Use one dark-red rose as a restrained compositional symbol.",
    "hat": "Use a hat or trench-coat detail only when it supports the route.",
    "paper": "Use newspaper, book, or document fragments as controlled narrative material.",
    "camera": "Use a camera or musical instrument as a coherent narrative prop.",
    "city": "Use city architecture or street lamps as supporting environmental cues.",
    "diagram": "Use technical diagrams, code interfaces, or energy-system graphics as restrained overlays.",
    "veil": "Use flowers, veil, or ribbon details as secondary accents.",
    "sword": "Use one safely positioned sheathed sword as a compositional symbol.",
    "smoke": "Use controlled mist or smoke while keeping facial landmarks readable.",
}

_RELATIONS = {
    "independent-layout": ("独立排版", "Keep the phrase as a disciplined layout layer with clear breathing room. It should support the portrait without pressing into essential facial landmarks."),
    "background-anchor": ("背景衬底", "Use the phrase as a large background anchor behind the silhouette. Keep the face, neck, and active hands clearly readable."),
    "interleaved-subject": ("与人物穿插", "Interleave the phrase with the portrait silhouette in a controlled front-and-back relationship. Preserve a complete readable face."),
    "subject-mask": ("人物镂空", "Use the exact phrase as a typographic mask or cutout container. Let selected portrait regions appear through the letterforms while keeping one complete recognizable face."),
    "ink-overlay": ("墨迹覆盖", "Treat the phrase as an expressive ink-brush overlay with controlled dry-brush edges and paper absorption. It may cross clothing or background, but protect the eyes, nose bridge, and mouth."),
}
_NEGATIVE = """Avoid duplicate faces, changed identity, body-proportion mismatch, stiff expression, frozen smile, dead eyes, vacant gaze, mismatched gaze through glass, theatrical eyeglass reflections, muddy overlapping faces, hidden neck, collar choking the throat, extra fingers, random readable text, brand logos, watermark-like marks, and pasted cutout staging.

EYEWEAR SAFETY: If clear glasses appear, keep lenses transparent and understated; eyes, pupils, and gaze must remain readable. Allow only subtle edge glints or small physically plausible source reflections. Avoid theatrical lens glare, heavy reflection plates, duplicate eyes, mismatched gaze through glass, and any reflection that hides identity. If sunglasses or dark lenses appear, make the lens behavior physically consistent and do not invent sharp eyes through opaque material.

LIGHTING PHYSICS SAFETY: Build the scene from a small number of plausible emitters. Keep one dominant key-light logic and make highlight, shadow, catchlight, rim light, reflected color, and cast-shadow direction agree with source geometry. Preserve skin detail and avoid clipped facial planes, disconnected shadows, random color patches, floating catchlights, decorative shadow stripes, duplicated cast shadows, detached hair veils, and every layer becoming equally smeared."""

_NEGATIVE_RICH = """Do not paste the subject onto a background. Do not mix incompatible style languages. Do not cover the full face. Do not copy visible watermarks, brands, sample titles, or platform labels from references. Do not use vacant, unfocused, or almost-camera eye direction. Do not use stiff mannequin poses, mirrored hands, generic clasped-hands posing, or anatomically implausible joints. Do not create excessive face overlap, muddy multi-face clusters, hard 180-degree backward twists, a pasted-on turned head, a hidden neck, or a fist clamped against the throat. Do not pull a collar so high that the jaw, neck base, or shoulder relationship becomes implausible. If sunglasses, dark glasses, goggles, or tinted lenses appear: opaque or mirrored lenses must hide both eyes fully; never render sharp pupils, irises, eyelashes, duplicate eyes, or mismatched gaze through dark lenses. Translucent lenses may show only soft low-contrast aligned eye hints subordinate to lens tint and reflection. Prefer lifted or handheld sunglasses when visible eye identity is important.

LIGHTING PHYSICS SAFETY: Build the scene from a small number of physically plausible emitters. Keep one dominant key-light logic and make highlight, shadow, catchlight, rim light, reflected color, and cast-shadow direction agree with the source geometry. Do not place bright rims on surfaces that cannot see the source. Do not light both sides of the face equally when using one directional key. Respect window-edge penumbra, indoor falloff, outdoor atmospheric fill, railing and hand occlusion shadows, and color spill only on surfaces facing the spill. Preserve skin detail and avoid clipping forehead, nose bridge, cheek, shoulder, white clothing, and reflective jewelry. Keep practical lamps, sun beams, neon reflections, haze, and ambient fill subordinate to a coherent exposure hierarchy. Avoid impossible multi-directional highlights, disconnected shadows, random color patches, floating catchlights, duplicated cast shadows, and overexposed facial planes.

HARD-SHADOW AND DIRECT-FLASH EXTENSION: For hard window sun, blind shadows, leaf shadows, hand shadows, and architectural occluders, preserve one continuous source path: shadow bands must keep a consistent direction, scale, softness, and surface continuity as they cross wall, clothing, hand, face, and furniture. Do not create decorative stripe patterns that change direction or float independently across the face. For direct on-camera flash, respect near-lens source geometry, inverse-square falloff, hard short cast shadows behind nearby objects, bright foreground priority, darker ambient background, and restrained specular response on skin, glasses, tableware, and glossy surfaces. Do not combine direct-flash flattening with unrelated cinematic rim lights unless a second visible practical source explains them.

CLEAR-LENS EYEWEAR SAFETY: When clear prescription glasses appear, keep both eyes anatomically aligned, readable, and naturally visible through transparent lenses. Treat each lens as one coherent optical surface attached to a stable frame resting on the nose bridge and temples. Under direct camera flash, allow only restrained physically plausible edge glints or small source reflections; do not place large white reflection blobs across both pupils unless the camera-source geometry genuinely supports it. Avoid duplicated irises, warped eyes, asymmetrical magnification, floating frames, detached temples, opaque clear lenses, and reflections that ignore the flash position. If the eyes become unreadable, reduce the reflection rather than inventing through-lens anatomy.

OCCLUDED-BEAM AND TWILIGHT-FLASH EXTENSION: For narrow warm beams, slit light, projector-like pools, door-gap light, and foreground veils, preserve one explainable aperture or occluder path. The lit region, shadow edge, penumbra, falloff, and surface continuity must agree across hair, eyelids, nose bridge, lips, neck, clothing, bedding, wall, and nearby objects. Keep facial landmarks readable even when much of the frame remains dark. For dusk beach direct flash, keep the near-lens flash responsible for foreground face and skin exposure while the sunset sky remains a separate low ambient field; do not brighten the ocean, sand, and distant horizon as if they share the same flash distance. For rooftop blue-hour portraits, allow one rear-side warm sunset rim and one restrained front fill or near-camera flash only when their roles remain visibly separable. Avoid blown halos, duplicated suns, arbitrary orange patches, flat beauty fill that erases twilight depth, and shadow bands that float independently of an occluder.

WIND, FLARE, MOTION-BLUR, AND BEDROOM-LIFESTYLE EXTENSION: For wind-led close-ups, keep hair strands attached to one airflow vector and allow only explainable strand shadows across skin. Preserve at least one clear eye, the nose bridge, and the mouth contour as identity anchors. For hand-intercepted warm beams, keep the hand, beam edge, face patch, and cast shadow on one aperture path. For golden-hour backlight, align lens flare, bloom, warm rim, and highlight roll-off to one low-sun axis; do not paste random colored orbs across the frame. For slow-shutter and panning portraits, separate subject motion, camera movement, background streak direction, and crisp post-layout typography. Retain one readable identity anchor and anatomically continuous limbs. For bedroom lifestyle scenes, use one window direction with plausible wall, desk, textile, and prop bounce; avoid overexposed skin, cluttered facial zones, floating headphones, and generic showroom rooms."""

_PROMPT_QUALITY_SECTIONS = [
    "reference-role",
    "identity-expression-gaze",
    "body-pose-anatomy",
    "scene-composition-light",
    "typography-intent",
    "negative-constraints",
    "final-priority",
]

# Chinese channel material for the doubao-seedream natural-language renderer.
# Derived from docs/V6_SEEDREAM_PROMPT_RESEARCH.md.
_IDENTITY_ZH = {
    "1": "严格保持人物面部身份：以最高身份保真度保持面部几何、标志性特征、年龄感、眼神、嘴部关系与发型轮廓全部稳定。",
    "2": "保持人物高度可辨认，仅做轻微柔化，同时保护决定身份的面部特征。",
    "3": "严格保持人物面部身份：保持脸型、眼神、嘴部关系、发型轮廓与关键特征，允许受控的材质转译。",
    "4": "保留可辨识脸型、眼神、发型和关键特征，同时允许明显的平面化或图形化转译。",
    "5": "允许强插画式转译，但必须保留最具辨识度的身份线索。",
}
_SCALE_ZH = {
    "auto": "根据当前路线自动选择人物尺度，同时保持人物清晰可辨认",
    "close": "采用贴脸或近景人像，人物约占画面 55%–80%，五官完整并留有自然呼吸感",
    "medium": "采用中景或半身人像，人物约占画面 35%–55%，肢体语言与环境上下文清晰可读",
    "narrative-readable": "采用叙事型构图，人物约占画面 25%–35%，仍然清晰可辨认",
    "small": "仅在环境承担主要叙事时使用小人物锚点，并保持人物有意可读",
    "full": "采用全身或近全身景别，重心落地、双手可读、空间有纵深",
}
_FACE_ZH = {
    "auto": "根据当前路线选择最适合的面部表现方式，并保留至少一张完整可读的脸。",
    "photo": "面部保持写实摄影质感，皮肤纹理与表情自然。",
    "soft": "保持摄影感，同时轻柔处理肤质、边缘和局部反差。",
    "editorial": "采用克制的编辑式转译，可使用颗粒、网点、纸张肌理或受控色块。",
    "graphic": "将面部转译为与整体构图一致的图形系统。",
    "fragments": "允许受控的面部碎片，但必须保留一张完整可读的脸。",
    "engrave": "通过雕版、交叉排线、刻线或印刷肌理转译面部。",
    "paint": "采用统一的绘画语言处理面部，笔触、边缘和光线保持一致。",
    "editorial-natural": "皮肤质感、面部体积、眼神与年龄感保持真实自然，避免塑料感磨皮与僵硬表情。",
    "documentary": "保留面部细微不对称与真实肤质，表情情绪可信，避免美颜滤镜式的扁平脸、空洞眼神与僵硬嘴角。",
    "polished": "使用克制的杂志级修饰，同时保持人物真实可辨认。",
    "1": "面部保持写实摄影质感，皮肤纹理与表情自然。",
    "2": "保持摄影感，同时轻柔处理肤质、边缘和局部反差。",
    "3": "采用克制的编辑式转译，可使用颗粒、网点、纸张肌理或受控色块。",
    "4": "将面部转译为与整体构图一致的图形系统。",
    "5": "采用统一的绘画语言处理面部，笔触、边缘和光线保持一致。",
}
_WARDROBE_ZH = {
    "auto": "根据当前路线自动重设或重构服装，让服装自然属于所选视觉路线。",
    "redesign": "完整重设服装，使版型、材质、颜色和层次匹配所选视觉路线。",
    "restyle": "保留服装类别，但重新设计颜色、面料、轮廓和叠穿关系。",
    "preserve": "尽量保留原始服装，仅调整光线、材质和局部细节以保持画面统一。",
    "graphic": "将服装转译到同一套图形、印刷、插画或拼贴材质语言中。",
    "route-redesign": "将原始服装视为舞台材料，重设服装、配饰和轮廓，使其自然属于所选路线。",
}
_FUSION_ZH = {
    "auto": "自动选择最合适的人物与世界融合方式，人物与背景必须像同一套创作，不要像后期贴图。",
    "photo": "通过光线方向、色温、阴影、景深、空气感与镜头质感统一人物和环境。",
    "editorial": "通过共享颗粒、色调压缩、边缘清晰度与编辑层级统一人物、服装、道具和背景。",
    "collage": "让面部、发丝、服装、道具和背景共同进入纸张、撕边、复印或杂志碎片逻辑。",
    "graphic": "将面部、发丝、服装、道具和背景转译为一套统一图形系统。",
    "paint": "使用一套统一绘画世界：共享笔触、柔化边缘、明亮光线与一致纵深。",
    "natural": "通过一致的阴影、反射光、材质接触、透视和环境色溢出，让人物真实嵌入场景，避免抠图粘贴感。",
}
_MOTIF_ZH = {
    "none": "除非单一物件能明显改善路线，否则不要额外增加象征性道具。",
    "rose": "使用一枝暗红色玫瑰作为克制的构图符号。",
    "hat": "仅在适合路线时加入帽子或风衣细节。",
    "paper": "使用报纸、书本或文件碎片作为受控叙事材料。",
    "camera": "使用相机或乐器作为连贯的叙事道具。",
    "city": "使用城市建筑或街灯作为辅助环境线索。",
    "diagram": "使用技术图纸、代码界面或能源系统图形作为克制叠层。",
    "veil": "使用花朵、头纱或丝带作为次级点缀。",
    "sword": "使用一把安全放置、带鞘的剑作为构图符号。",
    "smoke": "使用受控薄雾或烟气，同时保持五官清晰可读。",
}

_RELATIONS_ZH = {
    "independent-layout": "文字作为独立排版层，与人物保持清晰留白，不压住面部关键特征",
    "background-anchor": "文字作为大型背景衬底排在人物剪影之后，面部、颈部与活动的手保持清晰",
    "interleaved-subject": "文字与人物剪影前后穿插，形成受控的层次关系，保留一张完整可读的脸",
    "subject-mask": "文字作为镂空容器，人物局部从字形中透出，保持一张完整可辨认的脸",
    "ink-overlay": "文字以墨迹笔触覆盖在画面上，可越过服装与背景，但保护眼睛、鼻梁与嘴部",
}
_COMPONENT_GROUP_ZH = {
    "scene_presets": "场景",
    "prop_wardrobe_presets": "服装道具",
    "layout_modules": "版式",
    "typography_packs": "字体气质",
    "lighting_presets": "光线",
    "action_presets": "动作",
}
_NEGATIVE_ZH_ITEMS = [
    "身份漂移或换脸",
    "僵硬呆滞的表情与空洞眼神",
    "多余手指与扭曲肢体",
    "无关文字、标志与水印",
    "贴纸式抠图边缘与粘贴感",
]


def _find(list_name: str, item_id: Optional[str], id_key: str = "id") -> Optional[dict]:
    if not item_id:
        return None
    for item in get_library().get(list_name, []):
        if str(item.get(id_key)) == str(item_id):
            return item
    return None


def _first_text(item: Optional[dict], keys: Iterable[str]) -> str:
    if not item:
        return ""
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _mapped_instruction(mapping: Dict[str, str], value: Any, fallback: str, *, custom_prefix: str) -> str:
    """Resolve UI or legacy values without silently collapsing unknown route guidance."""
    key = str(value or fallback).strip()
    if key in mapping:
        return mapping[key]
    if key:
        return f"{custom_prefix}{key}."
    return mapping[fallback]


def _mapped_instruction_zh(mapping: Dict[str, str], value: Any, fallback: str, *, custom_prefix: str) -> str:
    """Chinese renderer equivalent of _mapped_instruction."""
    key = str(value or fallback).strip()
    if key in mapping:
        return mapping[key]
    if key:
        return f"{custom_prefix}{key}。"
    return mapping[fallback]


def _effective_text_strategy(config: dict) -> str:
    strategy = normalize_text_strategy(config.get("text_strategy"))
    phrase = str(config.get("generation_text") or "").strip()
    if strategy == "integrated-text" and not phrase:
        return "reserve-space"
    return strategy


_DEFAULT_POSTER_LAYOUT_SKELETON_ZH = (
    "建立真正可识别的海报骨架：人物主体与标题容器形成明确主次；保留一个主标题容器、一个底部信息带、"
    "一到两个克制的辅助图形层，并为副标题或日期留下低信息密度区域。主标题容器可以影响人物剪影、"
    "前后穿插、遮挡边界和色块节奏，但不得遮挡完整眼睛、鼻梁、嘴部、颈部与关键手势。"
)
_DEFAULT_POSTER_LAYOUT_SKELETON_EN = (
    "Build a recognizable poster skeleton rather than a portrait with accidental blank space: establish one primary headline container, "
    "one bottom information band, one or two restrained supporting graphic layers, and a low-information zone for subtitle or date copy. "
    "The headline container may influence silhouette spacing, controlled overlap boundaries, masking, and color-block rhythm, but must not cover "
    "complete eyes, the nose bridge, the mouth, the neck column, or active hands."
)


def _poster_layout_skeleton(config: Dict[str, Any], *, language: str) -> str:
    custom = str(config.get("poster_layout_skeleton") or "").strip()
    if custom:
        return custom
    return _DEFAULT_POSTER_LAYOUT_SKELETON_ZH if language == "zh" else _DEFAULT_POSTER_LAYOUT_SKELETON_EN


def _template_reference_section(config: Dict[str, Any], *, language: str) -> str:
    mode = str(config.get("template_reference_mode") or "recommended").strip()
    note = str(config.get("template_reference_note") or "").strip()
    if language == "zh":
        if mode == "none":
            return "【版式参考图规则】本次不依赖额外模板图，严格按下述海报骨架执行。"
        if mode == "attached":
            suffix = f" 补充说明：{note}" if note else ""
            return (
                "【版式参考图规则】最后一张上传图片是版式模板参考。只提取它的海报骨架、主体锚点、标题容器比例、"
                "留白位置、图层前后关系、色块节奏与印刷肌理；不要复制模板中的人物、人脸、品牌、可读文字、Logo、水印或具体内容。"
                + suffix
            )
        return (
            "【版式参考图规则】如额外上传一张模板图，请把最后一张图片仅视为版式参考：提取海报骨架、主体锚点、"
            "标题容器比例、留白、图层前后关系与材质节奏，不复制模板中的人物、人脸、品牌、可读文字、Logo 或水印。"
            "即使没有模板图，也必须按下述海报骨架完成构图。"
        )
    if mode == "none":
        return "LAYOUT REFERENCE RULE:\nDo not depend on an extra template image. Follow the poster skeleton below directly."
    if mode == "attached":
        suffix = f" Additional note: {note}" if note else ""
        return (
            "LAYOUT REFERENCE RULE:\nTreat the final uploaded image as a layout-reference template only. Extract poster skeleton, subject anchor, headline-container proportion, "
            "negative-space placement, layer order, color-block rhythm, and print texture. Do not copy its faces, brands, readable words, logos, watermarks, or concrete content."
            + suffix
        )
    return (
        "LAYOUT REFERENCE RULE:\nIf an additional template image is uploaded, treat the final image only as a layout reference. Extract poster skeleton, subject anchor, headline-container proportion, "
        "negative space, layer order, and material rhythm. Do not copy its faces, brands, readable words, logos, or watermarks. Even without a template, follow the poster skeleton below."
    )


def _poster_layout_section(config: Dict[str, Any], strategy: str, *, language: str) -> str:
    if strategy not in {"poster-layout", "integrated-text", "decorative-glyph", "free-experiment"}:
        return ""
    skeleton = _poster_layout_skeleton(config, language=language)
    if language == "zh":
        return "【海报骨架】" + skeleton
    return "POSTER LAYOUT SKELETON:\n" + skeleton


def _text_strategy_section(config: dict, effective_strategy: Optional[str] = None) -> str:
    strategy = effective_strategy or _effective_text_strategy(config)
    phrase = str(config.get("generation_text") or "").strip()
    _, relation_prompt = _RELATIONS.get(config.get("text_relation", "independent-layout"), _RELATIONS["independent-layout"])
    if strategy == "clean":
        return "TEXT PARTICIPATION STRATEGY — CLEAN IMAGE BASE:\nGenerate an image-only portrait base. Do not render any text, letters, words, numbers, logos, captions, subtitles, magazine mastheads, signatures, watermarks, barcodes, interface labels, pseudo-text, or readable symbols anywhere in the image."
    if strategy == "reserve-space":
        return f"TEXT PARTICIPATION STRATEGY — RESERVE SPACE WITHOUT RENDERING:\nThe intended future headline is: “{phrase or 'user will add a title later'}”. Use its approximate length only to plan calm, uninterrupted negative space. Do not render the actual phrase, letters, symbols, placeholder copy, or pseudo-text inside the generated image.\nSpatial relationship: {relation_prompt}"
    if strategy == "poster-layout":
        return f"TEXT PARTICIPATION STRATEGY — POSTER STRUCTURE WITHOUT READABLE COPY:\nGenerate a designed poster base, not merely a portrait with blank space. Build visible headline containers, supporting information bands, restrained graphic blocks, controlled overlap boundaries, and a clear editorial hierarchy. Keep all copy editable for the later layout layer: do not render actual words, letters, numbers, placeholder copy, or pseudo-text.\nSpatial relationship: {relation_prompt}"
    if strategy == "decorative-glyph":
        inspired = f" inspired by “{phrase}”" if phrase else ""
        return f"TEXT PARTICIPATION STRATEGY — DECORATIVE GLYPH TEXTURE:\nUse restrained abstract typographic fragments, ink traces, print bars, or glyph-like gestures as visual texture{inspired}. These marks do not need to be readable. Do not add random captions, fake logos, watermarks, or unrelated words.\nSpatial relationship: {relation_prompt}"
    if strategy == "integrated-text":
        return f"TEXT PARTICIPATION STRATEGY — INTEGRATE USER-SPECIFIED COPY:\nIntegrate the exact phrase “{phrase}” into the image composition as the only deliberate text anchor. Preserve wording, character order, and language as accurately as possible. The phrase may influence framing, silhouette, masking, foreground-background layering, and graphic balance.\nSpatial relationship: {relation_prompt}\nDo not generate unrelated titles, random captions, logos, watermarks, or extra typographic noise. Keep a clean editable version of the same phrase for the later layout correction layer."
    return f"TEXT PARTICIPATION STRATEGY — FREE TYPOGRAPHIC EXPERIMENT:\nUse “{phrase or 'optional user phrase'}” as the main typographic inspiration. Allow experimental lettering, fragmented glyphs, distressed brush forms, distorted editorial marks, or partially illegible type when visually appropriate. Preserve one readable portrait anchor and avoid unrelated brand names, logos, watermarks, or random copy.\nSpatial relationship: {relation_prompt}"


def _typography_output_contract(strategy: str) -> str:
    if strategy == "clean":
        return "Return a complete image-only portrait base with no letters, words, numbers, pseudo-text, logos, watermarks, barcodes, stickers, captions, or graphic labels."
    if strategy == "reserve-space":
        return "Return a visually complete image with calm uninterrupted negative space. Do not render actual words, placeholder copy, or pseudo-text."
    if strategy == "poster-layout":
        return "Return a visually complete poster base with an explicit editable layout skeleton: headline container, information band, supporting graphic blocks, and protected portrait zones. Do not render actual words, letters, numbers, placeholder copy, or pseudo-text."
    if strategy == "decorative-glyph":
        return "Decorative glyph texture is allowed only as subordinate visual material. Do not generate unrelated readable captions, brand names, or watermarks."
    if strategy == "integrated-text":
        return "The single user-supplied phrase may participate in the generated composition. Do not add unrelated copy. Preserve clean enough structure for later exact overlay correction."
    return "Experimental type is allowed, but preserve one strong portrait anchor and do not add unrelated logos, brand names, or watermarks."


def _record_section(title: str, item: Optional[dict]) -> str:
    if not item:
        return ""
    text = _first_text(item, ("prompt_en", "instruction_en", "summary_en", "prompt", "summary", "description_en"))
    name = item.get("name_zh") or item.get("name") or item.get("id")
    return f"{title} — {name}:\n{text}" if text else f"{title} — {name}."


def _render_structured_en(config: Dict[str, Any], route: dict, strategy: str, components: dict, scene_directive: str, scene_richness: str) -> List[str]:
    relation_name, relation_prompt = _RELATIONS.get(config.get("text_relation", "independent-layout"), _RELATIONS["independent-layout"])
    rich_mode = scene_richness == "rich"
    grouped_components: Dict[str, List[str]] = {}
    component_sections: List[str] = []
    visible_components = _visible_prompt_components(config, route, components)
    for item in visible_components:
        grouped_components.setdefault(item.get("component_group", ""), []).append(str(item.get("name_zh") or item.get("id")))
        if item.get("prompt_en"):
            component_sections.append(f"{item['component_group'].upper()} — {item['name_zh']}:\n{item['prompt_en']}")

    # Optional Human-First director controls. API clients can omit them and let
    # route defaults remain authoritative.
    controls = [
        _record_section("VISUAL TEMPLATE", _find("visual_templates", config.get("visual_template_id"))),
        _record_section("ROLE BLOCKING", _find("template_role_blockings", config.get("template_role_blocking_id"))),
        _record_section("SINGLE-PORTRAIT ACTION", _find("single_portrait_action_blueprints", config.get("single_action_blueprint_id"))),
        _record_section("GAZE LOCK", _find("single_portrait_gaze_locks", config.get("gaze_lock_id"))),
        _record_section("EXPRESSION", _find("single_portrait_expression_presets", config.get("expression_preset_id"))),
        _record_section("COMPOSITION BLUEPRINT", _find("single_portrait_composition_blueprints", config.get("composition_blueprint_id"))),
        _record_section("TYPOGRAPHY INTERACTION", _find("typography_interaction_presets", config.get("typography_interaction_preset_id"))),
        _record_section("TYPOGRAPHY PARTICIPATION MODE", _find("typography_participation_modes", config.get("typography_participation_mode_id"))),
    ]

    typography_names = "、".join(grouped_components.get("typography_packs", []))
    direction_label = _visual_direction_label(config, route)
    canonical_route_name = str(route.get("name_zh") or route.get("id") or "当前路线")
    direction_override = _has_visual_direction_override(config, route)
    metadata_block = (
        f"Selected visual direction: {direction_label}.\n"
        f"Archive: {route.get('category') or '通用'} → {route.get('subcategory') or '未分类'}\n"
        f"Internal data node: {route.get('id')}"
        if rich_mode
        else f"Selected visual direction: {direction_label}."
    )
    prompt_quality = (
        "PROMPT QUALITY CONTRACT:\n"
        "Preserve identity as facial features, landmark geometry, proportions, hairstyle silhouette, age impression, and distinctive marks. "
        "Rebuild expression and eye focus naturally; full preservation does not require rigidly cloning the source expression. "
        "Use source expression or a natural soft smile only."
    )
    typography_grammar = (
        f"SELECTED TYPOGRAPHY GRAMMAR:\n- {typography_names}"
        if typography_names
        else ""
    )
    visual_direction_label = str(config.get("visual_direction_label") or "").strip()
    visual_direction_brief = str(config.get("visual_direction_brief") or "").strip()
    visual_direction_section = (
        f"CURATED STYLE DIRECTION — {visual_direction_label or 'Selected quick-create direction'}:\n"
        f"{visual_direction_brief or 'Treat the selected direction as the authoritative visible style.'} "
        "This selected direction is authoritative for visible styling. Do not reintroduce internal compatibility-route wording or unrelated style language."
        if visual_direction_label or visual_direction_brief else ""
    )
    component_group_labels = {
        "scene_presets": "Scene Presets",
        "prop_wardrobe_presets": "Prop / Wardrobe Presets",
        "layout_modules": "Layout Modules",
        "typography_packs": "Typography Packs",
        "lighting_presets": "Lighting Presets",
        "action_presets": "Action Presets",
    }
    selected_component_summary: List[str] = []
    for key, label in component_group_labels.items():
        names = grouped_components.get(key, [])
        if names:
            selected_component_summary.append(f"- {label}: " + ", ".join(names))
    selected_component_text = "\n".join(selected_component_summary) if selected_component_summary else "- No explicit component overrides are selected; follow the route defaults, route summary, and current director controls as the primary source of stylistic coherence."
    route_world_summary = (
        visual_direction_brief
        if direction_override and visual_direction_brief
        else (route.get("summary") or route.get("prompt_core_en") or "No additional summary provided.")
    )
    rich_route_context = (
        f"ROUTE WORLD AND CREATIVE INTENT:\nTreat the selected visible direction as a coherent authored world, not as a loose mood tag. The visible direction is {direction_label}. Its archive position is {route.get('category') or '通用'} → {route.get('subcategory') or '未分类'}, and the internal data node is {route.get('id')}. Use this metadata to maintain discipline across wardrobe, environment, props, color rhythm, layout reserve, and emotional tone. Visible-direction summary: {route_world_summary} Do not dilute the selected direction with unrelated fashion tropes, random cinematic clichés, internal compatibility-route wording, or decorative objects that do not strengthen the requested visual direction."
        if rich_mode else ""
    )
    rich_scene_layering = (
        "RICH SCENE STAGING DIRECTIVE:\nConstruct the scene as a three-zone visual system. In the foreground, describe the nearest readable layer such as fabric edge, table surface, bouquet, paper, furniture line, railing, window frame, hand interaction, or another physically grounded material cue that helps scale the portrait. In the midground, let the subject remain the undisputed anchor and make pose, wardrobe, and light interaction explain the narrative moment. In the background, provide only those architectural, domestic, campus, street, or landscape cues that stabilize the route and deepen depth perception. Each zone should contribute to one coherent world. Use contact shadows, reflected color, and material transitions so the person feels embedded, not pasted."
        if rich_mode else ""
    )
    rich_component_block = (
        "ROUTE, TEMPLATE, COMPONENT, AND TYPOGRAPHY GRAMMAR:\nSummarize and obey the active modular decisions before rendering details. These modules are not decorative labels; they are execution constraints that shape staging, optical behavior, graphic hierarchy, and later layout compatibility.\n"
        f"{selected_component_text}\n"
        "If any selected module conflicts with route identity, preserve route coherence first, then keep the strongest module cues that still support identity fidelity and scene plausibility."
        if rich_mode else ""
    )
    rich_layout_extension = (
        "LAYOUT AND TYPOGRAPHY SAFETY EXTENSION:\nEven when the base image is image-only, compose as if a professional layout pass will follow. Reserve at least one calm zone where future masthead, cover line, caption, seal, or subtitle systems can sit without colliding with pupils, eyebrows, nose bridge, mouth contour, neck column, or active hands. If the strategy integrates text, treat that text as the only intentional typographic actor and keep all other surfaces clean. If the strategy reserves space, make the empty area feel intentional rather than accidental. Preserve clean silhouette separation, avoid busy micro-detail behind the face, and let typography-safe space emerge from composition instead of from awkward blank cutouts."
        if rich_mode else ""
    )
    rich_execution_priority = (
        "RICH EXECUTION PRIORITY:\nWhen multiple instructions compete, resolve them in this order: first facial identity and alive gaze; second expression credibility and anatomical integrity; third route coherence and scene plausibility; fourth lighting physics and material consistency; fifth typography-safe composition and editorial polish; sixth secondary motifs or graphic drama. If a requested flourish harms recognizability, remove or subordinate the flourish. If environment detail starts competing with the face, simplify the environment. If layout ambition compresses the portrait unnaturally, restore breathing room and protect the portrait anchor."
        if rich_mode else ""
    )
    art_direction_text = (
        visual_direction_brief
        if direction_override and visual_direction_brief
        else (route.get("prompt_core_en") or route.get("summary") or "")
    )
    composition_hygiene = (
        "COMPOSITION HYGIENE:\nUse coherent anatomy, natural body proportions, grounded weight distribution, readable hands, "
        "clean face separation, physically plausible perspective, and a deliberate negative-space hierarchy. "
        "Avoid hidden necks, rigid symmetry, mismatched body shape, exaggerated limbs, and decorative clutter competing with identity."
    )
    prompt_sections = [
        "IMAGE EDITING CREATIVE BRIEF",
        metadata_block,
        "DELIVERABLE:\nTransform the uploaded photograph into a polished portrait or poster-style image using one coherent visual route only.",
        "REFERENCE ROLE:\nUse uploaded photographs as the source of identity, facial features, and hairstyle silhouette. Original body posture, hand gestures, costume, and positioning are staging material that may be reinterpreted per the selected route. Do not mechanically preserve rigid original stances. Rebuild body language so the subject belongs naturally to the selected moment.",
        f"ART DIRECTION:\n{art_direction_text}",
        visual_direction_section,
        prompt_quality,
        typography_grammar,
        rich_route_context,
        rich_scene_layering,
        rich_component_block,
        f"IDENTITY, EXPRESSION, AND GAZE:\n{_mapped_instruction(_IDENTITY, config.get('identity_level'), '3', custom_prefix='Use this explicit identity guidance: ')} {_mapped_instruction(_FACE, config.get('face_mode'), 'editorial-natural', custom_prefix='Use this explicit facial-rendering guidance: ')}",
        "BODY, POSE, AND ANATOMY:\nMatch the uploaded person with believable body proportions, neck length, shoulder width, weight distribution, hands, and wardrobe scale. Avoid mannequin posture, rigid symmetry, twisted joints, and a pasted-on turned head.",
        "SCENE, COMPOSITION, LIGHT, AND MATERIAL:\nBuild one coherent staging world with readable depth, contact shadows, restrained material behavior, and a single dominant light logic. If glass or eyewear appears, reduce glare before hiding identity.",
        scene_directive,
        _template_reference_section(config, language="en") if strategy in {"poster-layout", "integrated-text", "decorative-glyph", "free-experiment"} else "",
        _poster_layout_section(config, strategy, language="en"),
        _text_strategy_section(config, strategy),
        rich_layout_extension,
        f"TYPOGRAPHY COMPOSITION RELATION — {relation_name}:\n{relation_prompt}\n{'User-supplied phrase: “' + str(config.get('generation_text')).strip() + '”.' if config.get('generation_text') else 'No user phrase has been entered yet.'}\nAccurate final copy remains editable in Layout Studio. Avoid covering the complete eyes, nose bridge, mouth, neck column, or active hands.",
        *controls,
        composition_hygiene,
        f"SUBJECT SCALE AND STAGING:\n{_mapped_instruction(_SCALE, config.get('subject_scale'), 'medium', custom_prefix='Use this explicit subject-scale guidance: ')}",
        f"FACIAL RENDERING:\n{_mapped_instruction(_FACE, config.get('face_mode'), 'editorial-natural', custom_prefix='Use this explicit facial-rendering guidance: ')}",
        f"WARDROBE:\n{_mapped_instruction(_WARDROBE, config.get('outfit_mode'), 'route-redesign', custom_prefix='Use this explicit wardrobe guidance: ')}",
        f"SUBJECT–WORLD FUSION:\n{_mapped_instruction(_FUSION, config.get('fusion_mode'), 'natural', custom_prefix='Use this explicit subject-world fusion guidance: ')}",
        f"OPTIONAL MOTIF:\n{_mapped_instruction(_MOTIF, config.get('motif_mode'), 'none', custom_prefix='Use this explicit motif guidance: ')} Keep any motif subordinate to identity and route coherence.",
        *component_sections,
        f"OUTPUT:\nAspect ratio: {config.get('ratio', '4:5')}.",
        f"TYPOGRAPHY OUTPUT CONTRACT:\n{_typography_output_contract(strategy)}",
        f"NEGATIVE CONSTRAINTS:\n{_NEGATIVE_RICH if rich_mode else _NEGATIVE}",
    ]
    note_lines = _unique_note_lines(config.get("subject_notes"), config.get("extra_request"))
    if note_lines:
        prompt_sections.append("USER CONTEXT AND EXTRA REQUEST:\n" + "\n".join(note_lines))
    prompt_sections.append(rich_execution_priority)
    prompt_sections.append("FINAL PRIORITY:\nPreserve recognizable identity to the greatest extent compatible with the selected route. Make gaze, hands, weight distribution, wardrobe, props, environment, typography grammar, and graphic surface feel authored as one coherent living moment.")
    return prompt_sections


def _seedream_typography_sentences(config: Dict[str, Any], strategy: str, typography_hint: str) -> str:
    phrase = str(config.get("generation_text") or "").strip()
    relation_zh = _RELATIONS_ZH.get(config.get("text_relation", "independent-layout"), _RELATIONS_ZH["independent-layout"])
    if strategy == "clean":
        return "画面中不要出现任何文字、字母、数字、标志、字幕或水印。"
    if strategy == "reserve-space":
        plan = f"未来标题约为“{phrase}”的长度，" if phrase else ""
        return f"{plan}为后期排版预留安静完整的负空间，不要渲染任何实际文字、占位文案或伪文字。"
    if strategy == "poster-layout":
        plan = f"未来主标题约为“{phrase}”的长度，" if phrase else ""
        return (
            f"{plan}生成完成度较高的海报版式底图，而不是只有留白的人像照片：让主标题容器、底部信息带、"
            "辅助色块、边界线和受控图层关系明确参与构图。所有文字仍交给后期排版，不要渲染任何实际文字、字母、数字、"
            f"占位文案或伪文字；{relation_zh}。"
        )
    if strategy == "decorative-glyph":
        inspired = f"以“{phrase}”为灵感，" if phrase else ""
        return f"{inspired}可使用克制的抽象字形、墨迹或印刷质感笔触作为装饰纹理，无需可读；{relation_zh}。不要出现无关的可读文字、标志或水印。"
    if strategy == "integrated-text":
        font_part = f"，字体气质参考「{typography_hint}」" if typography_hint else ""
        return (
            f"在画面中绘制文字“{phrase}”，作为唯一刻意出现的文字元素，保持字句、字符顺序与语言准确{font_part}。"
            f"文字与人物的关系：{relation_zh}。不要生成任何无关标题、标语、标志或水印。"
        )
    font_part = f"，字体气质参考「{typography_hint}」" if typography_hint else ""
    return (
        f"以“{phrase or '用户稍后提供的短语'}”为主要文字灵感，允许实验性字形、碎裂笔触或部分不可读的字体表现{font_part}；"
        f"{relation_zh}。保留一个清晰可读的人物主体，不要出现无关品牌名、标志或水印。"
    )


def _visual_direction_label(config: Dict[str, Any], route: dict) -> str:
    label = str(config.get("visual_direction_label") or "").strip()
    return label or str(route.get("name_zh") or route.get("id") or "当前路线")


def _has_visual_direction_override(config: Dict[str, Any], route: dict) -> bool:
    """Return True when a quick-create style alias must be authoritative in visible prompt text."""
    label = str(config.get("visual_direction_label") or "").strip()
    canonical = str(route.get("name_zh") or route.get("id") or "").strip()
    return bool(label and label != canonical)


def _visible_prompt_components(config: Dict[str, Any], route: dict, components: dict) -> List[dict]:
    """Hide compatibility-route defaults when a curated quick-style alias is active.

    The canonical route still remains available in API metadata and layout/risk
    planning. Only user-visible model instructions are filtered so an internal
    compatibility route cannot leak conflicting style language into the prompt.
    """
    items = list(components.get("resolved_components", []))
    if not _has_visual_direction_override(config, route):
        return items
    return [item for item in items if item.get("source") == "director_config.selected_component_ids"]


def _unique_note_lines(*values: Any) -> List[str]:
    lines: List[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line or line in seen:
                continue
            seen.add(line)
            lines.append(line)
    return lines


def _render_natural_zh(config: Dict[str, Any], route: dict, strategy: str, components: dict, profile: Dict[str, Any], scene_richness: str) -> List[str]:
    """Render a coherent natural-Chinese prompt for doubao-seedream.

    Segment order now follows a stronger execution contract for Seedream-like
    models: task → must preserve → staging → composition/light → typography
    → negatives → execution priority.
    """
    phrase = str(config.get("generation_text") or "").strip()
    text_participates = strategy in {"poster-layout", "integrated-text", "decorative-glyph", "free-experiment"}
    deliverable = "完成度较高的人像视觉海报底图" if strategy == "poster-layout" else ("人像海报" if (text_participates or phrase) else "人像作品")
    ratio = config.get("ratio", "4:5")
    direction_label = _visual_direction_label(config, route)
    direction_brief = str(config.get("visual_direction_brief") or "").strip()

    grouped: Dict[str, List[str]] = {}
    direction_override = _has_visual_direction_override(config, route)
    for item in _visible_prompt_components(config, route, components):
        grouped.setdefault(item.get("component_group", ""), []).append(str(item.get("name_zh") or item.get("id")))
    typography_hint = "、".join(grouped.get("typography_packs", []))

    def names(group: str) -> str:
        return "、".join(grouped.get(group, []))

    purpose = f"【任务】以图生图方式，将上传的人像照片重绘为「{direction_label}」风格的{deliverable}，画幅比例 {ratio}。"

    identity = (
        "【必须保留｜人物身份优先】"
        + _mapped_instruction_zh(_IDENTITY_ZH, config.get("identity_level"), "3", custom_prefix="按照这一身份保真指导执行：")
        + _mapped_instruction_zh(_FACE_ZH, config.get("face_mode"), "editorial-natural", custom_prefix="按照这一面部表现指导执行：")
    )

    pose_bits = [_mapped_instruction_zh(_SCALE_ZH, config.get("subject_scale"), "medium", custom_prefix="按照这一人物尺度指导执行：")]
    action = _find("single_portrait_action_blueprints", config.get("single_action_blueprint_id"))
    if action:
        pose_bits.append(f"动作参考「{action.get('name_zh') or action.get('id')}」")
    expression = _find("single_portrait_expression_presets", config.get("expression_preset_id"))
    if expression:
        pose_bits.append(f"表情按「{expression.get('name_zh') or expression.get('id')}」处理")
    if names("action_presets"):
        pose_bits.append(f"姿态融入{names('action_presets')}")
    pose = "【人物姿态与肢体】" + "，".join(pose_bits) + "；身体重心可信、双手自然可读，避免模特假人式僵硬站姿。"

    scene_chunks: List[str] = []
    if direction_brief:
        scene_chunks.append(direction_brief.rstrip("。"))
    summary = str(route.get("summary") or "").strip()
    if not direction_override and summary and summary != direction_brief:
        scene_chunks.append(summary.rstrip("。"))
    if names("scene_presets"):
        scene_chunks.append(f"场景包含{names('scene_presets')}")
    if names("prop_wardrobe_presets"):
        scene_chunks.append(f"服装与道具参考{names('prop_wardrobe_presets')}")
    directive = str(profile.get("scene_richness_directives", {}).get(scene_richness, "") or "").strip()
    if directive:
        scene_chunks.append(directive.rstrip("。"))
    scene = "【场景与风格世界】" + "。".join(chunk for chunk in scene_chunks if chunk) + "。" if scene_chunks else ""

    comp_bits = []
    composition = _find("single_portrait_composition_blueprints", config.get("composition_blueprint_id"))
    if composition:
        comp_bits.append(f"构图参考「{composition.get('name_zh') or composition.get('id')}」")
    if names("layout_modules"):
        comp_bits.append(f"版式融入{names('layout_modules')}")
    if names("lighting_presets"):
        comp_bits.append(f"光线采用{names('lighting_presets')}")
    comp_bits.append("使用 35-50mm 的自然人像焦段，保持单一主光逻辑，高光、阴影与眼神光方向一致，皮肤细节真实")
    composition_light = "【构图与光线】" + "，".join(comp_bits) + "。"

    wardrobe_fusion = (
        "【服装与人物世界融合】"
        + _mapped_instruction_zh(_WARDROBE_ZH, config.get("outfit_mode"), "route-redesign", custom_prefix="按照这一服装指导执行：")
        + _mapped_instruction_zh(_FUSION_ZH, config.get("fusion_mode"), "natural", custom_prefix="按照这一人物与世界融合指导执行：")
    )
    motif = "【可选元素】" + _mapped_instruction_zh(_MOTIF_ZH, config.get("motif_mode"), "none", custom_prefix="按照这一可选元素指导执行：")

    typography = "【文字与留白】" + _seedream_typography_sentences(config, strategy, typography_hint)

    template = _find("visual_templates", config.get("visual_template_id"))
    style_bits = [f"整体风格：{direction_label}"]
    if template:
        style_bits.append(f"视觉模板参考「{template.get('name_zh') or template.get('id')}」")
    style = "【整体统一性】" + "，".join(style_bits) + "，质感真实统一，避免风格混搭。"

    max_items = int(profile.get("max_negative_items", 5))
    negative = "【禁止项】画面中不要出现：" + "、".join(_NEGATIVE_ZH_ITEMS[:max_items]) + "。"

    priority = (
        "【执行优先级】先保证人物身份稳定与眼神自然，其次保证姿态、手部、光线和空间逻辑成立，"
        "再保证风格、版式留白与局部图形细节；如果发生冲突，优先保护脸部识别、表情可信度与整体画面统一性。"
    )

    sections = {
        "purpose": purpose,
        "identity": identity,
        "pose-action": pose,
        "scene": scene,
        "composition-light": composition_light,
        "template-reference": _template_reference_section(config, language="zh") if strategy in {"poster-layout", "integrated-text", "decorative-glyph", "free-experiment"} else "",
        "poster-layout": _poster_layout_section(config, strategy, language="zh"),
        "wardrobe-fusion": wardrobe_fusion,
        "motif": motif,
        "typography": typography,
        "style": style,
        "negative": negative,
        "priority": priority,
    }
    order = profile.get("segment_order") or list(sections)
    rendered = [sections[key] for key in order if sections.get(key)]
    for key, value in sections.items():
        if key not in order and value:
            rendered.append(value)
    note_lines = _unique_note_lines(config.get("subject_notes"), config.get("extra_request"))
    if note_lines:
        rendered.append("【补充要求】" + "\n".join(note_lines))
    return rendered


def compile_prompt(config: Dict[str, Any]) -> Dict[str, Any]:
    validation = validate_director_config(config)
    config = validation["config"]
    profile = get_profile(config.get("provider"))
    scene_richness = resolve_scene_richness(profile, config.get("scene_richness"))
    route = get_route(config["route_id"])
    requested_strategy = normalize_text_strategy(config.get("text_strategy"))
    strategy = _effective_text_strategy(config)
    effective_config = {**config, "text_strategy": strategy}
    components = resolve_components(route["id"], config.get("selected_component_ids") or [])
    risks = resolve_risks(effective_config, route)
    layout_plan = create_layout_plan(effective_config, route)
    relation_name, _ = _RELATIONS.get(config.get("text_relation", "independent-layout"), _RELATIONS["independent-layout"])

    if profile.get("renderer") == "natural-zh":
        prompt_sections = _render_natural_zh(config, route, strategy, components, profile, scene_richness)
        prompt_text = "\n\n".join(section for section in prompt_sections if section)
    else:
        scene_directive = profile.get("scene_richness_directives", {}).get(scene_richness, "")
        prompt_sections = _render_structured_en(config, route, strategy, components, scene_directive, scene_richness)
        prompt_text = "\n\n".join(section for section in prompt_sections if section)

    warnings = validation["warnings"] + components["warnings"] + [risk["mitigation"] for risk in risks if risk["level"] == "warning"]
    return {
        "route": {"route_id": route["id"], "name_zh": route.get("name_zh"), "category": route.get("category"), "subcategory": route.get("subcategory")},
        "prompt": prompt_text,
        "layout_plan": layout_plan,
        "components": components,
        "risks": risks,
        "warnings": warnings,
        "provider": {
            "id": profile["id"],
            "label_zh": profile.get("label_zh"),
            "renderer": profile.get("renderer"),
            "maturity": profile.get("maturity", "stable"),
            "maturity_note_zh": profile.get("maturity_note_zh"),
            "maturity_badge_zh": profile.get("maturity_badge_zh"),
            "scene_richness": scene_richness,
            "contract": "pvos-provider-profiles@1.2.0",
        },
        "parity": {
            "contract": "v5.13.2-human-first-prompt-channels@1.0.0",
            "text_strategy": strategy,
            "requested_text_strategy": requested_strategy,
            "text_relation": config.get("text_relation"),
            "prompt_quality_contract": "v6-prompt-quality-system@0.2.0",
            "prompt_quality_sections": _PROMPT_QUALITY_SECTIONS,
            "ui_strategy_modes": ["clean", "reserve-space", "poster-layout", "decorative-glyph", "integrated-text", "free-experiment"],
            "template_reference_mode": config.get("template_reference_mode"),
            "poster_layout_skeleton": config.get("poster_layout_skeleton") or None,
            "ui_relation_modes": list(_RELATIONS),
            "provider": profile["id"],
            "scene_richness": scene_richness,
        },
        "explanations": [
            f"选择视觉方向：{_visual_direction_label(config, route)}。{str(config.get('visual_direction_brief') or route.get('summary', ''))}",
            f"目标模型：{profile.get('label_zh')}（{profile['id']}）；场景丰富度：{scene_richness}。",
            f"文字参与策略：{strategy}；文字与人物关系：{relation_name}。",
            f"模板参考规则：{config.get('template_reference_mode')}；海报骨架：{'已使用自定义骨架' if config.get('poster_layout_skeleton') else '使用系统默认骨架'}。",
            layout_plan["explanation"],
            "风险提示由显式规则生成，可以由人类导演覆盖，但不会被静默忽略。",
        ],
    }
