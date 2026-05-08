from collections.abc import Sequence
import math


def simple_return(v_begin: float, v_end: float, net_cash_inflow: float) -> float | None:
    if v_begin == 0:
        return None
    return (v_end - v_begin - net_cash_inflow) / v_begin


def time_weighted_return(subperiod_returns: Sequence[float]) -> float | None:
    if not subperiod_returns:
        return None
    growth = 1.0
    for subperiod in subperiod_returns:
        growth *= 1.0 + subperiod
    return growth - 1.0


def money_weighted_return(
    cash_flows: Sequence[tuple[float, float]],
    *,
    min_rate: float = -0.9999,
    max_rate: float = 10.0,
    max_iterations: int = 120,
    tolerance: float = 1e-8,
) -> float | None:
    if len(cash_flows) < 2:
        return None
    has_positive = any(amount > 0 for _, amount in cash_flows)
    has_negative = any(amount < 0 for _, amount in cash_flows)
    if not (has_positive and has_negative):
        return None

    def npv(rate: float) -> float:
        total = 0.0
        for years, amount in cash_flows:
            total += amount / ((1.0 + rate) ** years)
        return total

    low = min_rate
    high = max_rate
    f_low = npv(low)
    f_high = npv(high)
    if math.isclose(f_low, 0.0, abs_tol=tolerance):
        return low
    if math.isclose(f_high, 0.0, abs_tol=tolerance):
        return high
    if f_low * f_high > 0:
        return None

    for _ in range(max_iterations):
        mid = (low + high) / 2.0
        f_mid = npv(mid)
        if math.isclose(f_mid, 0.0, abs_tol=tolerance):
            return mid
        if f_low * f_mid < 0:
            high = mid
            f_high = f_mid
        else:
            low = mid
            f_low = f_mid
    return (low + high) / 2.0
