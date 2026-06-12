"""PVOS V6 provider profile registry.

Loads target-model prompt rendering profiles from library/provider_profiles.json.
Each profile describes how the deterministic channel outputs of the prompt
compiler are rendered for one image-generation provider family
(e.g. gpt-image structured English vs. doubao-seedream natural Chinese).

The registry is data-driven per the V5.17.2 audit recommendation so that
profile rules can evolve without editing compiler code.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

PROFILE_CONTRACT = "pvos-provider-profiles@1.2.0"
SUPPORTED_RICHNESS = ("compact", "standard", "rich")
SUPPORTED_MATURITY = ("stable", "test", "experimental")

_PROFILE_PATH = Path(__file__).resolve().parent.parent / "library" / "provider_profiles.json"


class ProviderProfileError(RuntimeError):
    pass


def _validate(data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise ProviderProfileError("provider profiles must be a JSON object")
    if data.get("contract") != PROFILE_CONTRACT:
        raise ProviderProfileError(f"unexpected provider profile contract: {data.get('contract')}")
    providers = data.get("providers")
    if not isinstance(providers, dict) or not providers:
        raise ProviderProfileError("provider profiles require providers{}")
    default_provider = data.get("default_provider")
    if default_provider not in providers:
        raise ProviderProfileError(f"default_provider not defined: {default_provider}")
    for name, profile in providers.items():
        if not isinstance(profile, dict):
            raise ProviderProfileError(f"provider {name} must be an object")
        richness = profile.get("default_scene_richness")
        if richness not in SUPPORTED_RICHNESS:
            raise ProviderProfileError(f"provider {name} has invalid default_scene_richness: {richness}")
        directives = profile.get("scene_richness_directives")
        if not isinstance(directives, dict) or set(directives) != set(SUPPORTED_RICHNESS):
            raise ProviderProfileError(f"provider {name} must define directives for {SUPPORTED_RICHNESS}")
        if profile.get("renderer") not in ("structured-en", "natural-zh"):
            raise ProviderProfileError(f"provider {name} has unknown renderer: {profile.get('renderer')}")
        maturity = profile.get("maturity", "stable")
        if maturity not in SUPPORTED_MATURITY:
            raise ProviderProfileError(f"provider {name} has invalid maturity: {maturity}")
    return data


@lru_cache(maxsize=1)
def get_provider_registry() -> Dict[str, Any]:
    if not _PROFILE_PATH.exists():
        raise ProviderProfileError(f"provider profiles not found: {_PROFILE_PATH}")
    try:
        data = json.loads(_PROFILE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ProviderProfileError(f"provider profiles invalid JSON: {exc}") from exc
    return _validate(data)


def reload_provider_registry() -> Dict[str, Any]:
    get_provider_registry.cache_clear()
    return get_provider_registry()


def default_provider() -> str:
    return str(get_provider_registry()["default_provider"])


def supported_providers() -> list[str]:
    return sorted(get_provider_registry()["providers"])


def get_profile(provider: str | None) -> Dict[str, Any]:
    registry = get_provider_registry()
    name = str(provider or registry["default_provider"]).strip()
    profile = registry["providers"].get(name)
    if profile is None:
        raise ValueError(f"unsupported provider: {name}")
    return {**profile, "id": name}


def resolve_scene_richness(profile: Dict[str, Any], requested: str | None) -> str:
    if requested is None or str(requested).strip() == "":
        return str(profile["default_scene_richness"])
    value = str(requested).strip()
    if value not in SUPPORTED_RICHNESS:
        raise ValueError(f"unsupported scene_richness: {value}")
    return value
