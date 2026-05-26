from app.api.currency_conversion import normalize_currency_code


def resolve_account_base_currency(raw_repository: object | None, items: list[dict] | None = None) -> str:
    latest = None
    if raw_repository is not None:
        try:
            latest = raw_repository.get_latest_account_snapshot()
        except Exception:
            latest = None
    candidates: list[object] = [(latest or {}).get("base_currency")]
    for item in items or []:
        candidates.append(item.get("base_currency"))
        candidates.append(item.get("currency"))
    for candidate in candidates:
        code = normalize_currency_code(candidate, "")
        if code:
            return code
    return "USD"


def resolve_activity_display_currency(
    raw_repository: object | None,
    items: list[dict],
    *,
    selected_currency: str | None = None,
    currency_keys: tuple[str, ...] = ("currency",),
) -> str:
    selected = normalize_currency_code(selected_currency, "")
    if selected:
        return selected
    account_currency = resolve_account_base_currency(raw_repository)
    currencies: set[str] = set()
    for item in items:
        for key in currency_keys:
            code = normalize_currency_code(item.get(key), "")
            if code:
                currencies.add(code)
                break
    if len(currencies) == 1 and account_currency == "USD":
        return next(iter(currencies))
    return account_currency
