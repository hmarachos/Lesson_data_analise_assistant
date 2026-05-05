from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse

from app.routes.pages import chat_service, render_page, templates
from app.services.chat_service import ChatNotFoundError

router = APIRouter()


def _stream_event(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _now_label() -> str:
    return datetime.now(tz=UTC).strftime("%H:%M UTC")


def _chunk_text(text: str, chunk_size: int = 18):
    words = text.split(" ")
    buffer: list[str] = []
    size = 0
    for word in words:
        buffer.append(word)
        size += len(word) + 1
        if size >= chunk_size:
            yield " ".join(buffer) + " "
            buffer = []
            size = 0
    if buffer:
        yield " ".join(buffer)


@router.post("/chat/{conversation_id}/message")
async def send_message(
    request: Request,
    conversation_id: str,
    message_text: str = Form(default=""),
    data_file: UploadFile | None = File(default=None),
):
    try:
        conversation = await chat_service.process_turn(conversation_id, message_text, data_file)
    except ChatNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чат не найден.") from exc

    return render_page(
        request,
        "chat.html",
        "partials/chat_shell.html",
        chat_service.build_page_context(request, conversation),
    )


@router.post("/chat/{conversation_id}/message/stream")
async def stream_message(
    request: Request,
    conversation_id: str,
    message_text: str = Form(default=""),
    data_file: UploadFile | None = File(default=None),
):
    async def event_stream():
        user_text = (message_text or "").strip()
        if user_text or (data_file and data_file.filename):
            yield _stream_event(
                "user",
                {
                    "text": user_text or "Загрузил файл для обработки.",
                    "time_label": _now_label(),
                    "file_name": data_file.filename if data_file and data_file.filename else None,
                },
            )

        yield _stream_event(
            "status",
            {
                "title": "Нейросеть думает",
                "text": "Собираю контекст, читаю файл и отправляю запрос модели.",
                "step": 1,
            },
        )

        try:
            conversation = await chat_service.process_turn(conversation_id, message_text, data_file)
        except ChatNotFoundError:
            yield _stream_event("error", {"text": "Чат не найден."})
            return
        except Exception as exc:  # pragma: no cover - defensive streaming boundary
            yield _stream_event("error", {"text": f"Не удалось обработать запрос: {exc}"})
            return

        messages = conversation.get("messages", [])
        assistant_message = next(
            (message for message in reversed(messages) if message.get("role") == "assistant"),
            None,
        )
        assistant_text = (assistant_message or {}).get("text", "")

        yield _stream_event(
            "status",
            {
                "title": "Ответ готов",
                "text": "Печатаю ответ и обновляю артефакты.",
                "step": 2,
            },
        )
        yield _stream_event("assistant_start", {"time_label": (assistant_message or {}).get("time_label", _now_label())})

        for chunk in _chunk_text(assistant_text):
            yield _stream_event("delta", {"text": chunk})
            await asyncio.sleep(0.018)

        context = chat_service.build_page_context(request, conversation)
        html = templates.env.get_template("partials/chat_shell.html").render(context)
        yield _stream_event("refresh", {"html": html})
        yield _stream_event("done", {})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat/{conversation_id}/activate/{file_id}")
async def activate_file(request: Request, conversation_id: str, file_id: str):
    try:
        conversation = chat_service.activate_file(conversation_id, file_id)
    except ChatNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чат не найден.") from exc

    return render_page(
        request,
        "chat.html",
        "partials/chat_shell.html",
        chat_service.build_page_context(request, conversation),
    )
