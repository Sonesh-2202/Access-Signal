from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
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
    key = get_storage().save(data, ext)
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


@router.get("/{evidence_id}/file")
def evidence_file(evidence_id: str, db: Session = Depends(get_db)) -> FileResponse:
    ev = db.get(Evidence, evidence_id)
    # Unattached uploads are private drafts; the client previews them locally.
    if ev is None or ev.file_path is None or ev.report_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence not found")
    if ev.report and ev.report.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence not found")
    try:
        path = get_storage().path_for(ev.file_path)
    except FileNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence not found") from None
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence file missing")
    return FileResponse(path, media_type=ev.mime_type, headers={"Cache-Control": "public, max-age=86400",
                                                                "X-Content-Type-Options": "nosniff"})
