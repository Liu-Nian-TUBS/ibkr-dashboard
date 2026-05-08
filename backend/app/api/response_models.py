from enum import Enum

from pydantic import BaseModel


class StorageFailureType(str, Enum):
    CONFIG_ERROR = "config_error"
    STORAGE_CONNECT_ERROR = "storage_connect_error"


class StorageAuthMode(str, Enum):
    NONE = "none"
    BASIC = "basic"
    API_KEY = "api_key"


class StorageUnavailableResponse(BaseModel):
    code: str
    message: str
    failureType: StorageFailureType
    lastCheckedAt: str | None
    traceId: str


STORAGE_UNAVAILABLE_OPENAPI_RESPONSE = {
    503: {"model": StorageUnavailableResponse}
}
