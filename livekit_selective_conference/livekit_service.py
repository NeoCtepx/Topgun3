"""LiveKit SDK integration for issuing participant tokens with visibility metadata."""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from typing import Dict, List

from .visibility import VisibilityRule, build_visibility_rules, resolve_visible_video_for


class LiveKitConfigurationError(RuntimeError):
    """Raised when LiveKit configuration is missing."""


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise LiveKitConfigurationError(
            f"Environment variable '{name}' is required for LiveKit token creation"
        )
    return value


def create_visibility_metadata(participant_id: str, rules: List[VisibilityRule]) -> str:
    """Serialize visibility metadata for client-side selective subscription logic."""
    visible_video_ids = resolve_visible_video_for(participant_id, rules)
    payload = {
        "participant_id": participant_id,
        "audio_scope": "all",
        "visible_video_participants": visible_video_ids,
    }
    return json.dumps(payload, ensure_ascii=False)


def create_livekit_token(participant_id: str, room_name: str, rules: List[VisibilityRule]) -> str:
    """Create a LiveKit JWT token using livekit-server-sdk.

    Metadata embeds visibility matrix so the client can subscribe only to the
    allowed remote video tracks while still subscribing to all audio tracks.
    """
    api_key = _require_env("LIVEKIT_API_KEY")
    api_secret = _require_env("LIVEKIT_API_SECRET")

    try:
        from livekit.api import AccessToken, VideoGrants
    except ImportError as exc:
        raise ImportError(
            "Install dependency: pip install livekit-api"
        ) from exc

    metadata = create_visibility_metadata(participant_id=participant_id, rules=rules)

    token = (
        AccessToken(api_key, api_secret)
        .with_identity(participant_id)
        .with_name(participant_id)
        .with_metadata(metadata)
        .with_grants(
            VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
            )
        )
    )

    return token.to_jwt()


def default_group_map_16() -> Dict[str, List[str]]:
    """Example mapping for 16 participants.

    4 primary viewers (P1..P4), each sees a private set of 3 participants.
    """
    return {
        "P1": ["U1", "U2", "U3"],
        "P2": ["U4", "U5", "U6"],
        "P3": ["U7", "U8", "U9"],
        "P4": ["U10", "U11", "U12"],
    }


def export_rules(group_map: Dict[str, List[str]]) -> List[Dict[str, object]]:
    """Useful helper for API endpoints/debugging."""
    return [asdict(rule) for rule in build_visibility_rules(group_map)]
