from uuid import uuid4

from fastapi import FastAPI, Request


def generate_trace_id() -> str:
    return uuid4().hex


def register_trace_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def _attach_trace_id(request: Request, call_next):
        request.state.trace_id = generate_trace_id()
        response = await call_next(request)
        response.headers["X-Trace-Id"] = request.state.trace_id
        return response
