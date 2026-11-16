from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api.dependencies import current_user
from app.api.serializers import evidence_out
from app.core.config import get_settings
from app.core.database import get_db
from app.models import Evidence, User
from app.schemas import EvidenceOut
from app.services.storage import UnsupportedFile, get_storage, sniff
from app.utils.images import strip_jpeg_metadata

router = APIRouter(prefix="/api/evidence", tags=["evidence"])


@router.post("", response_model=EvidenceOut, status_code=status.HTTP_201_CREATED)
async def upload_evidence(
    file: UploadFile = File(...),
    transcription: str | None = Form(default=None, max_length=4000),
    alt_text: str | None = Form(default=None, max_length=300),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> EvidenceOut:
    limit = get_settings().max_file_size_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"Files must be under {get_settings().max_file_size_mb} MB")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is empty")
    try:
        mime, ext, kind = sniff(data)
    except UnsupportedFile as e:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(e)) from None
    if mime == "image/jpeg":
        data = strip_jpeg_metadata(data)
    # Sniffing and metadata stripping above run on every backend, before any bytes leave this process.
    try:
        key = get_storage().save(data, ext, mime)
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "File storage is unavailable. Try again shortly.") from None
    ev = Evidence(
        type=kind, file_path=key, mime_type=mime,
        transcription=(transcription or "").strip() or None,
        meta={"uploader_id": user.id, "size": len(data),
              "original_name": Path(file.filename or "").name[:120] or None,
              "alt_text": (alt_text or "").strip() or None},
    )
    db.add(ev)
    db.commit()
    return evidence_out(ev)


@router.get("/{evidence_id}/file", response_class=Response)
def evidence_file(evidence_id: str, db: Session = Depends(get_db)) -> Response:
    ev = db.get(Evidence, evidence_id)
    # Unattached uploads are private drafts; the client previews them locally.
    # These checks run before the storage backend is touched, so no signed URL is ever
    # issued for a draft or for evidence on a deleted report.
    if ev is None or ev.file_path is None or ev.report_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence not found")
    if ev.report and ev.report.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence not found")
    try:
        return get_storage().response(ev.file_path, ev.mime_type)
    except FileNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence file missing") from None
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "File storage is unavailable") from None
