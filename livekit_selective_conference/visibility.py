"""Visibility matrix utilities for selective video subscriptions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Set


@dataclass(frozen=True)
class VisibilityRule:
    viewer_id: str
    visible_video_participants: List[str]


class VisibilityValidationError(ValueError):
    """Raised when the input visibility matrix is invalid."""


def build_visibility_rules(group_map: Dict[str, List[str]]) -> List[VisibilityRule]:
    """Build and validate unique viewer->video visibility rules.

    Args:
        group_map: mapping where key is a primary participant (viewer) and
            value is a list of participants whose video should be visible only
            to that viewer.

    Returns:
        List[VisibilityRule]: validated rules.

    Raises:
        VisibilityValidationError: if participant appears in more than one group
            or if a viewer is present inside their own visible group.
    """
    used_video_publishers: Set[str] = set()
    rules: List[VisibilityRule] = []

    for viewer_id, visible_list in group_map.items():
        visible_unique = list(dict.fromkeys(visible_list))

        if viewer_id in visible_unique:
            raise VisibilityValidationError(
                f"Viewer '{viewer_id}' cannot be inside their own video list"
            )

        overlap = used_video_publishers.intersection(visible_unique)
        if overlap:
            raise VisibilityValidationError(
                "Video publishers must be unique across groups. "
                f"Overlapping IDs: {sorted(overlap)}"
            )

        used_video_publishers.update(visible_unique)
        rules.append(VisibilityRule(viewer_id=viewer_id, visible_video_participants=visible_unique))

    return rules


def resolve_visible_video_for(viewer_id: str, rules: Iterable[VisibilityRule]) -> List[str]:
    """Return a list of participant IDs whose video should be visible to viewer."""
    for rule in rules:
        if rule.viewer_id == viewer_id:
            return list(rule.visible_video_participants)
    return []
