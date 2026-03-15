"""API for issuing LiveKit tokens and admin-managed invite links."""

from __future__ import annotations

import base64
import json
import os
import uuid
from typing import Dict, List, Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field

from .livekit_service import LiveKitConfigurationError, create_livekit_token
from .visibility import VisibilityValidationError, build_visibility_rules

load_dotenv()

app = FastAPI(title="Конференция API", version="1.3.0")
security = HTTPBasic()

allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TokenRequest(BaseModel):
    room_name: str
    participant_id: str
    group_map: Dict[str, List[str]]
    invite_id: str | None = None


class AdminInviteRequest(BaseModel):
    participant_id: str
    room_name: str
    livekit_url: str
    api_base_url: str
    mode: Literal["allow_list", "deny_list"] = "allow_list"
    chat_enabled: bool = True
    unique_link: bool = False
    conference_topic: str = "Конференция"
    allow_video_participants: List[str] = Field(default_factory=list)
    deny_video_participants: List[str] = Field(default_factory=list)
    all_video_participants: List[str] = Field(default_factory=list)


class AdminAuthResponse(BaseModel):
    ok: bool


INVITE_REGISTRY: Dict[str, dict] = {}
USED_INVITES: set[str] = set()


class ChatHistoryResponse(BaseModel):
    room_name: str
    messages: List[dict]


class ChatMessageRequest(BaseModel):
    room_name: str
    invite_id: str | None = None
    sender_name: str
    text: str


CHAT_HISTORY: Dict[str, List[dict]] = {}


def _validate_admin(credentials: HTTPBasicCredentials = Depends(security)) -> None:
    admin_username = os.getenv("ADMIN_USERNAME")
    admin_password = os.getenv("ADMIN_PASSWORD")

    if not admin_username or not admin_password:
        raise HTTPException(
            status_code=500,
            detail=(
                "ADMIN_USERNAME/ADMIN_PASSWORD are not configured. "
                "Set them in .env (not .env.example) and restart containers."
            ),
        )

    if credentials.username != admin_username or credentials.password != admin_password:
        raise HTTPException(status_code=403, detail="Неверный логин или пароль администратора")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/admin/auth-check", response_model=AdminAuthResponse)
def admin_auth_check(_: None = Depends(_validate_admin)) -> AdminAuthResponse:
    return AdminAuthResponse(ok=True)


@app.post("/token")
def token(payload: TokenRequest) -> dict:
    if payload.invite_id:
        invite = INVITE_REGISTRY.get(payload.invite_id)
        if not invite:
            raise HTTPException(status_code=404, detail="Ссылка приглашения не найдена")
        if invite.get("unique_link") and payload.invite_id in USED_INVITES:
            raise HTTPException(status_code=409, detail="Эта ссылка уже была использована")

        expected_group_map = invite.get("group_map")
        if (
            invite.get("participant_id") != payload.participant_id
            or invite.get("room_name") != payload.room_name
            or expected_group_map != payload.group_map
        ):
            raise HTTPException(status_code=400, detail="Данные приглашения не совпадают")

    try:
        rules = build_visibility_rules(payload.group_map)
        jwt = create_livekit_token(
            participant_id=payload.participant_id,
            room_name=payload.room_name,
            rules=rules,
        )
    except VisibilityValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LiveKitConfigurationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if payload.invite_id:
        invite = INVITE_REGISTRY.get(payload.invite_id)
        if invite and invite.get("unique_link"):
            USED_INVITES.add(payload.invite_id)

    return {"token": jwt}


def _compute_allowed_video_ids(payload: AdminInviteRequest) -> List[str]:
    if payload.mode == "allow_list":
        return list(dict.fromkeys(payload.allow_video_participants))

    deny = set(payload.deny_video_participants)
    return [pid for pid in payload.all_video_participants if pid not in deny]


@app.post("/admin/invite")
def create_invite(payload: AdminInviteRequest, _: None = Depends(_validate_admin)) -> dict:
    allowed_video = _compute_allowed_video_ids(payload)
    group_map = {payload.participant_id: allowed_video}

    try:
        build_visibility_rules(group_map)
    except VisibilityValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    invite_id = str(uuid.uuid4())
    invite_data = {
        "participant_id": payload.participant_id,
        "room_name": payload.room_name,
        "group_map": group_map,
        "chat_enabled": payload.chat_enabled,
        "unique_link": payload.unique_link,
        "conference_topic": payload.conference_topic,
    }
    INVITE_REGISTRY[invite_id] = invite_data

    invite_payload = {
        "participant_id": payload.participant_id,
        "room_name": payload.room_name,
        "livekit_url": payload.livekit_url,
        "api_base_url": payload.api_base_url,
        "group_map": group_map,
        "invite_id": invite_id,
        "chat_enabled": payload.chat_enabled,
        "unique_link": payload.unique_link,
        "conference_topic": payload.conference_topic,
    }
    encoded = base64.urlsafe_b64encode(json.dumps(invite_payload).encode("utf-8")).decode("utf-8")

    public_web_base_url = os.getenv("PUBLIC_WEB_BASE_URL", "http://185.219.7.21:8080")
    invite_url = f"{public_web_base_url}/?invite={encoded}"
    return {"invite_url": invite_url, "group_map": group_map}


@app.get("/chat/history", response_model=ChatHistoryResponse)
def chat_history(room_name: str) -> ChatHistoryResponse:
    return ChatHistoryResponse(room_name=room_name, messages=CHAT_HISTORY.get(room_name, []))


@app.post("/chat/post")
def chat_post(payload: ChatMessageRequest) -> dict:
    if payload.invite_id and payload.invite_id not in INVITE_REGISTRY:
        raise HTTPException(status_code=404, detail="Ссылка приглашения не найдена")

    message = {
        "sender": payload.sender_name.strip()[:120] or "Участник",
        "text": payload.text.strip()[:4000],
    }
    if not message["text"]:
        raise HTTPException(status_code=400, detail="Пустое сообщение")

    room_messages = CHAT_HISTORY.setdefault(payload.room_name, [])
    room_messages.append(message)
    if len(room_messages) > 300:
        del room_messages[:-300]

    return {"ok": True}
