from collections.abc import Mapping


def to_float(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def optional_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def positive_float_or_none(value: object, *, digits: int | None = None) -> float | None:
    parsed = optional_float(value)
    if parsed is None or parsed <= 0:
        return None
    return round(parsed, digits) if digits is not None else parsed


def first_number(row: Mapping[str, object], keys: tuple[str, ...]) -> float | None:
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        try:
            return float(str(value).replace(",", ""))
        except (TypeError, ValueError):
            continue
    return None
