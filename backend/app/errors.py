"""Typed API errors. Messages are written for the person using the app and never
contain stack traces, filesystem paths or raw exception text."""

from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, hint: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.hint = hint

    def to_body(self) -> dict:
        body = {"code": self.code, "message": self.message}
        if self.hint:
            body["hint"] = self.hint
        return {"error": body}


def model_unavailable(detail: str) -> ApiError:
    return ApiError(
        503,
        "model_unavailable",
        "Analysis is unavailable because the trained model did not pass its readiness checks.",
        detail,
    )
