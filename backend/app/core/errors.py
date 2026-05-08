from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.trace import generate_trace_id


class AppError(Exception):
    def __init__(self, message: str, *, code: str = "APP_ERROR", status_code: int = 400) -> None:
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)


def _trace_id_from_request(request: Request) -> str:
    return getattr(request.state, "trace_id", generate_trace_id())


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": exc.code,
                "message": exc.message,
                "traceId": _trace_id_from_request(request),
            },
        )

    @app.exception_handler(HTTPException)
    async def _handle_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": f"HTTP_{exc.status_code}",
                "message": str(exc.detail),
                "traceId": _trace_id_from_request(request),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_request_validation_error(
        request: Request, _: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "code": "REQUEST_VALIDATION_ERROR",
                "message": "Request validation failed",
                "traceId": _trace_id_from_request(request),
            },
        )

    @app.exception_handler(Exception)
    async def _handle_unexpected_exception(request: Request, _: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_SERVER_ERROR",
                "message": "Internal server error",
                "traceId": _trace_id_from_request(request),
            },
        )
