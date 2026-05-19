from __future__ import annotations

import argparse
import json
import sys
from contextlib import redirect_stdout
from typing import Any

from app.services.mcp_tools import ReadOnlyMCPTools


_PROTOCOL_STDOUT = sys.stdout


def _tool_context() -> ReadOnlyMCPTools:
    from app.main import derived_repository, raw_repository, settings_service, _quote_service_instance

    return ReadOnlyMCPTools(
        raw_repository=raw_repository,
        derived_repository=derived_repository,
        settings_service=settings_service,
        quote_service=_quote_service_instance,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="IBKR Dashboard read-only MCP stdio server")
    parser.add_argument("--list-tools", action="store_true")
    parser.add_argument("--call", choices=None)
    parser.add_argument("--arguments", default="{}")
    args = parser.parse_args()
    if args.list_tools:
        tools = _tool_context()
        print(json.dumps({"tools": tools.list_tools()}, ensure_ascii=False))
        return
    if args.call:
        tools = _tool_context()
        print(json.dumps(tools.call_tool(args.call, json.loads(args.arguments)), ensure_ascii=False))
        return
    with redirect_stdout(sys.stderr):
        tools = _tool_context()
        _serve_stdio(tools, output=_PROTOCOL_STDOUT)


def _serve_stdio(tools: ReadOnlyMCPTools, *, output: Any = sys.stdout) -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        response = _handle_json_rpc(request, tools)
        if response is None:
            continue
        output.write(json.dumps(response, ensure_ascii=False) + "\n")
        output.flush()


def _handle_json_rpc(request: dict[str, Any], tools: ReadOnlyMCPTools) -> dict[str, Any] | None:
    if "id" not in request:
        return None

    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "ibkr-dashboard-readonly", "version": "0.1.0"},
            },
        }
    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}
    if method == "tools/list":
        with redirect_stdout(sys.stderr):
            listed_tools = tools.list_tools()
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": listed_tools}}
    if method == "tools/call":
        with redirect_stdout(sys.stderr):
            result = tools.call_tool(str(params.get("name") or ""), params.get("arguments") or {})
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
                "isError": result.get("status") == "error",
            },
        }
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": "method_not_found"},
    }


if __name__ == "__main__":
    main()
