from datetime import date


def validate_backfill_range(start_date: date, end_date: date) -> None:
    if end_date < start_date:
        raise ValueError("end_before_start")
    if (end_date - start_date).days > 365:
        raise ValueError("range_too_large")
