from datetime import datetime
from zoneinfo import ZoneInfo


def _parse_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if len(raw) == 8 and raw.isdigit():
        try:
            return datetime.strptime(raw, "%Y%m%d")
        except ValueError:
            return None
    if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-" and "T" not in raw:
        try:
            return datetime.strptime(raw[:10], "%Y-%m-%d")
        except ValueError:
            return None
    candidate = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=ZoneInfo("UTC"))
        return parsed
    except ValueError:
        return None


def normalize_date_to_iso(value: object) -> str | None:
    parsed = _parse_datetime(value)
    if parsed is not None:
        return parsed.date().isoformat()
    raw = "" if value is None else str(value).strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) >= 8:
        date_digits = digits[:8]
        return f"{date_digits[:4]}-{date_digits[4:6]}-{date_digits[6:8]}"
    return None


def normalize_month_bucket(value: object, *, timezone_name: str) -> str | None:
    parsed = _parse_datetime(value)
    if parsed is not None:
        if parsed.tzinfo is not None:
            local = parsed.astimezone(ZoneInfo(timezone_name))
            return local.strftime("%Y%m")
        return parsed.strftime("%Y%m")
    raw = "" if value is None else str(value).strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) >= 6:
        return digits[:6]
    return None


def normalize_datetime_to_local_iso(value: object, *, timezone_name: str) -> str | None:
    parsed = _parse_datetime(value)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo("UTC"))
    return parsed.astimezone(ZoneInfo(timezone_name)).isoformat()
