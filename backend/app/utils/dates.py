from datetime import date


def compact_date(value: object) -> str:
    text = str(value or "")
    digits = "".join(ch for ch in text if ch.isdigit())
    return digits[:8]


def compact_report_date(value: object) -> str:
    return compact_date(value)


def parse_iso_date(value: object) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    digits = compact_date(raw)
    if len(digits) == 8:
        try:
            return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))
        except ValueError:
            return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None
