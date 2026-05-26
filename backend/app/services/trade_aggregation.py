from collections.abc import Callable

from app.utils.numbers import to_float


def build_monthly_trade_stats(
    trades: list[dict],
    *,
    month_for_trade: Callable[[dict], str | None],
    value_key: str,
    limit: int = 12,
    chronological: bool = False,
) -> list[dict]:
    grouped: dict[str, dict[str, float | int | str]] = {}
    for trade in trades:
        month = month_for_trade(trade)
        if not month:
            continue
        notional_abs = abs(to_float(trade.get("quantity")) * to_float(trade.get("trade_price")))
        bucket = grouped.setdefault(month, {"month": month, "trade_count": 0, value_key: 0.0})
        bucket["trade_count"] = int(bucket["trade_count"]) + 1
        bucket[value_key] = float(bucket[value_key]) + notional_abs
    rows = list(grouped.values())
    rows.sort(key=lambda row: str(row["month"]), reverse=True)
    rows = rows[:limit]
    if chronological:
        rows.sort(key=lambda row: str(row["month"]))
    return rows
