"""NeuroScan AI backend.

Run from the repository root:
    uvicorn backend.app.main:app --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import APP_VERSION, Settings
from .errors import ApiError
from .history import HistoryStore
from .inference import InferenceService, RunnerFactory, default_runner_factory
from .schemas import AnalysisResult, HealthResponse, HistoryEntry, Limits, ModelInfoResponse
from .validation import SUPPORTED_FORMATS, decode_upload

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("neuroscan.api")

MULTIPART_OVERHEAD = 64 * 1024


class BodySizeLimit:
    """Reject request bodies above a limit before they are fully read.

    Checks Content-Length when present and counts streamed bytes otherwise,
    so a chunked upload cannot bypass the limit."""

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        length = headers.get(b"content-length")
        too_large = ApiError(
            413,
            "file_too_large",
            f"The upload is larger than the {self.max_bytes // (1024 * 1024)} MB limit.",
            "Export the slice at a smaller size.",
        )
        if length is not None and length.isdigit() and int(length) > self.max_bytes + MULTIPART_OVERHEAD:
            await JSONResponse(too_large.to_body(), status_code=413)(scope, receive, send)
            return

        received = 0
        exceeded = False

        async def limited_receive():
            nonlocal received, exceeded
            if exceeded:
                return {"type": "http.request", "body": b"", "more_body": False}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes + MULTIPART_OVERHEAD:
                    # Stop reading; the truncated body fails to parse and the
                    # response is replaced with a 413 below.
                    exceeded = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        replaced = False

        async def guarded_send(message):
            nonlocal replaced
            if exceeded:
                if message["type"] == "http.response.start" and not replaced:
                    replaced = True
                    response = JSONResponse(too_large.to_body(), status_code=413)
                    await send({"type": "http.response.start", "status": 413, "headers": response.raw_headers})
                    await send({"type": "http.response.body", "body": response.body})
                return
            await send(message)

        await self.app(scope, limited_receive, guarded_send)


def create_app(settings: Optional[Settings] = None, runner_factory: Optional[RunnerFactory] = None) -> FastAPI:
    settings = settings or Settings()
    service = InferenceService(settings.model_dir, runner_factory or default_runner_factory)
    history: Optional[HistoryStore] = None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal history
        await run_in_threadpool(service.load)
        if settings.history_enabled:
            history = HistoryStore(settings.history_db)
        yield
        if history is not None:
            history.close()

    app = FastAPI(
        title="NeuroScan AI API",
        version=APP_VERSION,
        description="Research prototype: 2D brain MRI slice classification with a locally trained model. Not for clinical use.",
        lifespan=lifespan,
    )
    app.state.service = service
    # Added first so it sits inside CORS: 413 responses still carry CORS headers.
    app.add_middleware(BodySizeLimit, max_bytes=settings.max_upload_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
    )

    # ------------------------------------------------------------ error shape
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(exc.to_body(), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        missing_file = any(e.get("loc", [None])[-1] == "file" for e in exc.errors())
        err = ApiError(
            400,
            "invalid_request",
            "No image file was included in the request." if missing_file else "The request was not in the expected format.",
            "Send the image as multipart form data in a field named 'file'." if missing_file else None,
        )
        return JSONResponse(err.to_body(), status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        message = {404: "Not found.", 405: "This method is not allowed here."}.get(exc.status_code, "The request failed.")
        return JSONResponse({"error": {"code": code, "message": message}}, status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        logger.exception("Unhandled error")
        return JSONResponse({"error": {"code": "internal_error", "message": "Something went wrong on the server."}}, status_code=500)

    # ----------------------------------------------------------------- routes
    def limits() -> Limits:
        return Limits(
            max_upload_bytes=settings.max_upload_bytes,
            max_pixels=settings.max_pixels,
            max_side=settings.max_side,
            min_side=settings.min_side,
            formats=sorted(SUPPORTED_FORMATS),
        )

    @app.get("/api/health", response_model=HealthResponse)
    def health():
        meta = service.meta
        return HealthResponse(
            status="ok",
            app_version=APP_VERSION,
            model_ready=service.readiness.ready,
            model_version=meta.model_version if meta and service.readiness.ready else None,
            loaded_at=service.readiness.loaded_at,
        )

    @app.get("/api/model-info", response_model=ModelInfoResponse)
    def model_info():
        r = service.readiness
        return ModelInfoResponse(
            ready=r.ready,
            checks=r.checks,
            loaded_at=r.loaded_at,
            metadata=service.meta.model_dump() if service.meta and r.ready else None,
            limits=limits(),
            history_enabled=settings.history_enabled,
            app_version=APP_VERSION,
        )

    @app.post("/api/model/reload", response_model=ModelInfoResponse)
    async def reload_model():
        await run_in_threadpool(service.load)
        return model_info()

    @app.get("/api/evaluation")
    def evaluation():
        path = settings.model_dir / "evaluation.json"
        if not path.is_file():
            raise ApiError(
                404,
                "evaluation_unavailable",
                "No evaluation report has been generated yet.",
                "Run ml/train.py (or ml/evaluate.py) to create model/evaluation.json.",
            )
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ApiError(
                500, "evaluation_invalid", "The evaluation report could not be read.", "Re-run ml/evaluate.py to regenerate it."
            ) from None
        if service.meta and report.get("model_version") != service.meta.model_version:
            report["version_mismatch"] = True
        return report

    @app.post("/api/analyze", response_model=AnalysisResult)
    async def analyze(
        file: UploadFile = File(...),
        request_id: Optional[str] = Form(default=None, max_length=64),
        explain: bool = Query(default=True),
    ):
        if not service.readiness.ready:
            raise ApiError(
                503,
                "model_unavailable",
                "Analysis is unavailable because the trained model is not ready.",
                service.readiness.first_failure(),
            )
        started = time.perf_counter()
        data = await file.read(settings.max_upload_bytes + 1)
        await file.close()
        decoded = await run_in_threadpool(
            decode_upload,
            data,
            max_bytes=settings.max_upload_bytes,
            max_pixels=settings.max_pixels,
            max_side=settings.max_side,
            min_side=settings.min_side,
        )
        decoded_at = time.perf_counter()
        try:
            result: AnalysisResult = await asyncio.wait_for(
                run_in_threadpool(service.analyze, decoded, explain=explain, client_request_id=request_id),
                timeout=settings.inference_timeout_s,
            )
        except asyncio.TimeoutError:
            raise ApiError(
                504,
                "inference_timeout",
                "The analysis took too long and was stopped.",
                "Try again. The first analysis after starting can be slower.",
            ) from None
        result.timing.decode_ms = round((decoded_at - started) * 1000, 1)
        result.timing.total_ms = round((time.perf_counter() - started) * 1000, 1)
        if history is not None:
            await run_in_threadpool(history.add, result)
        logger.info("analysis %s status=%s total_ms=%.0f", result.analysis_id, result.status, result.timing.total_ms)
        return result

    def require_history() -> HistoryStore:
        if history is None:
            raise ApiError(404, "history_disabled", "History is turned off on this server.")
        return history

    @app.get("/api/history", response_model=list[HistoryEntry])
    def list_history():
        return require_history().list()

    @app.get("/api/history/{analysis_id}", response_model=HistoryEntry)
    def get_history(analysis_id: str):
        entry = require_history().get(analysis_id)
        if entry is None:
            raise ApiError(404, "analysis_not_found", "No saved analysis has this ID.")
        return entry

    @app.delete("/api/history/{analysis_id}")
    def delete_history(analysis_id: str):
        if not require_history().delete(analysis_id):
            raise ApiError(404, "analysis_not_found", "No saved analysis has this ID.")
        return {"deleted": 1}

    @app.delete("/api/history")
    def clear_history():
        return {"deleted": require_history().clear()}

    # Serve the built frontend when it exists, so one process can run the demo.
    dist: Path = settings.frontend_dist
    if (dist / "index.html").is_file():
        index = dist / "index.html"

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise ApiError(404, "not_found", "Not found.")
            candidate = (dist / path).resolve()
            if path and candidate.is_file() and dist.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(index)

    return app


app = create_app()
