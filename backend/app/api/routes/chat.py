"""POST /api/chat: a read-only assistant over public report, place and route data.

Nothing here writes to the database. The route creates no reports, issues, notes or audit
rows, and the server keeps no conversation state: the browser sends the history each time.
The assistant gets only the context the server builds from public data (see chat.py)."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import chat_request, current_user
from app.core.database import get_db
from app.models import User
from app.schemas import ChatIn, ChatOut
from app.services.ai.chat import (
    ChatUnavailableError,
    build_context,
    generate,
    normalise_language,
    select_sources,
    trim_history,
)
from app.services.ai.providers import Provider

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatOut)
def chat(body: ChatIn, _: User = Depends(current_user), db: Session = Depends(get_db),
         byok: Provider | None = Depends(chat_request)) -> ChatOut:
    messages, trimmed = trim_history(body.messages)
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type a question to get an answer")
    bundle = build_context(db, body.context)
    try:
        result = generate(messages, bundle, byok, language=normalise_language(body.language))
    except ChatUnavailableError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from None
    return ChatOut(
        answer=result.answer,
        sources=select_sources(result.answer, bundle),
        source=result.source,
        model=result.model,
        truncated=trimmed or bundle.truncated,
    )
