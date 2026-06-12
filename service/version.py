"""Single source of truth for the PVOS sealed visual core and user-facing runtime build."""

VISUAL_CORE_VERSION = "5.16.1"
VERSION = VISUAL_CORE_VERSION  # Backward-compatible API field for sealed-core consumers.
RUNTIME_BUILD = "V6.1.1"
UI_BUILD = "v6101-20260612"
PRODUCT_NAME = "Portrait Visual OS"
RUNTIME_NAME = "PVOS Prompt Runtime"
RELEASE_CHANGELOG = (
    "V6.1.1 Poster Structure Runtime: annotate provider maturity — GPT is the only relatively mature baseline (主线), "
    "Doubao Seedream is a test build (测试版) with basic Chinese constraint compilation only. "
    "Promote Doubao to stable only after a parity audit. Provider-profile contract bumped to 1.2.0 to carry maturity metadata. "
    "No functional prompt changes from V6.1.0; UI now shows a 测试版 badge next to the Doubao button and an explicit warning when Doubao is selected."
)
