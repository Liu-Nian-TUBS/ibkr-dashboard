from collections.abc import Callable
import time
from ssl import SSLError
import ssl
from xml.etree import ElementTree as ET
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import httpx


class FlexStatementClient:
    """IBKR Flex Web Service client.

    TLS/network flakiness (especially through VPNs or regional routing) can trigger
    intermittent SSL EOF errors. We retry a few times with backoff for transport errors.
    """

    def __init__(
        self,
        *,
        base_url: str = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService",
        client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(
            timeout=httpx.Timeout(20.0, connect=8.0),
            limits=httpx.Limits(max_connections=10),
            http2=False,
            follow_redirects=True,
        )
        self._external_client = client is not None

    def _request_get(self, *, path: str, params: dict[str, str]) -> httpx.Response:
        last_error: Exception | None = None
        url = f"{self._base_url}/{path}"
        for attempt in range(4):
            try:
                if self._external_client:
                    return self._client.get(url, params=params)
                # Use a fresh client each attempt to avoid reusing broken TLS sessions.
                with httpx.Client(
                    timeout=httpx.Timeout(20.0, connect=8.0),
                    limits=httpx.Limits(max_connections=10),
                    http2=False,
                    follow_redirects=True,
                ) as client:
                    return client.get(url, params=params)
            except (httpx.TransportError, SSLError, OSError) as exc:
                last_error = exc
                if attempt == 3:
                    break
                time.sleep(0.4 * (2**attempt))
        # Fallback to urllib for environments where httpx TLS handshake is flaky.
        try:
            query = urlencode(params)
            with urlopen(Request(f"{url}?{query}", method="GET"), timeout=15) as response:
                body = response.read().decode("utf-8", errors="replace")
                status = getattr(response, "status", 200)
            return httpx.Response(status_code=status, text=body)
        except Exception as exc:  # pragma: no cover - runtime network fallback
            last_error = exc
        # Last-resort TLS fallback for environments with broken SSL middleboxes.
        try:  # pragma: no cover - runtime network fallback
            query = urlencode(params)
            insecure_ctx = ssl._create_unverified_context()
            req = Request(
                f"{url}?{query}",
                method="GET",
                headers={"User-Agent": "ibkr-dashboard-flex-client/1.0"},
            )
            with urlopen(req, timeout=15, context=insecure_ctx) as response:
                body = response.read().decode("utf-8", errors="replace")
                status = getattr(response, "status", 200)
            return httpx.Response(status_code=status, text=body)
        except Exception as exc:
            last_error = exc
        assert last_error is not None
        raise RuntimeError(
            "flex network error (check VPN/proxy/firewall or try again later): "
            f"{last_error!s}"
        ) from last_error

    def request_reference_code(self, *, token: str, query_id: str) -> str:
        response = self._request_get(path="SendRequest", params={"t": token, "q": query_id, "v": "3"})
        if response.status_code >= 400:
            raise RuntimeError(f"flex send request failed: {response.status_code}")
        reference_code = _extract_xml_field(response.text, "ReferenceCode")
        if not reference_code:
            raise RuntimeError("flex send request missing reference code")
        return reference_code

    def download_statement(self, *, token: str, reference_code: str) -> str:
        response = self._request_get(
            path="GetStatement",
            params={"t": token, "q": reference_code, "v": "3"},
        )
        if response.status_code >= 400:
            raise RuntimeError(f"flex get statement failed: {response.status_code}")
        return response.text

    def fetch_statement_xml(
        self,
        *,
        token: str,
        query_id: str,
        max_attempts: int = 5,
        poll_interval_seconds: float = 1.0,
        sleeper: Callable[[float], object] | None = None,
    ) -> str:
        if max_attempts <= 0:
            raise ValueError("max_attempts must be greater than 0")
        reference_code = self.request_reference_code(token=token, query_id=query_id)
        sleep_fn = sleeper or (lambda _: None)

        for attempt in range(max_attempts):
            statement = self.download_statement(token=token, reference_code=reference_code)
            if _looks_like_ready_statement(statement):
                return statement
            if attempt < max_attempts - 1:
                sleep_fn(poll_interval_seconds)
        raise RuntimeError("flex statement not ready before max attempts")


def _extract_xml_field(xml_text: str, tag: str) -> str | None:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None
    node = root.find(f".//{tag}")
    if node is None or node.text is None:
        return None
    return node.text.strip()


def _looks_like_ready_statement(xml_text: str) -> bool:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return False
    return root.tag == "FlexQueryResponse"
