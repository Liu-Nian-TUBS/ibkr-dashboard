import json
import shutil
import subprocess


def run_longbridge_json(
    args: list[str],
    *,
    timeout: float = 8.0,
    executable_resolver=shutil.which,
    runner=subprocess.run,
) -> object:
    executable = executable_resolver("longbridge")
    if executable is None:
        return []
    try:
        completed = runner(
            [executable, *args],
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if completed.returncode != 0 or not completed.stdout.strip():
        return []
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError:
        return []


def longbridge_records(payload: object) -> list[dict]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)]
        return [payload]
    return []


def first_longbridge_record(payload: object) -> dict | None:
    rows = longbridge_records(payload)
    return rows[0] if rows else None
