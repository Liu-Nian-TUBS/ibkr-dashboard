import importlib


def load_futu_module(importer=importlib.import_module):
    try:
        return importer("futu")
    except ImportError:
        return None


def normalize_futu_symbol(symbol: str) -> str:
    cleaned = str(symbol or "").strip().upper()
    if not cleaned:
        return "US.AAPL"
    if cleaned.startswith(("US.", "HK.", "SH.", "SZ.")):
        return cleaned
    if "." in cleaned:
        parts = cleaned.split(".")
        if len(parts) == 2 and parts[1] in {"US", "HK", "SH", "SZ"}:
            return f"{parts[1]}.{parts[0]}"
        return cleaned
    if cleaned.isdigit():
        if len(cleaned) == 5:
            return f"HK.{cleaned}"
        if cleaned.startswith(("6", "9")):
            return f"SH.{cleaned}"
        return f"SZ.{cleaned}"
    return f"US.{cleaned}"


def normalize_longbridge_symbol(symbol: str) -> str:
    cleaned = str(symbol or "").strip().upper()
    if not cleaned:
        return "AAPL.US"
    index_aliases = {
        "^GSPC": ".SPX.US",
        "GSPC": ".SPX.US",
        "SP500": ".SPX.US",
        "^IXIC": ".IXIC.US",
        "IXIC": ".IXIC.US",
        "COMP": ".IXIC.US",
        "^NDX": ".NDX.US",
        "NDX": ".NDX.US",
        "^DJI": ".DJI.US",
        "DJI": ".DJI.US",
        "^VIX": ".VIX.US",
        "VIX": ".VIX.US",
    }
    if cleaned in index_aliases:
        return index_aliases[cleaned]
    if "." in cleaned:
        parts = cleaned.split(".")
        if parts[0].isdigit() and parts[-1] == "HK":
            parts[0] = str(int(parts[0]))
            return ".".join(parts)
        if len(parts) == 2 and parts[0].startswith("^") and parts[1] == "US":
            return f".{parts[0][1:]}.US"
        return cleaned
    if cleaned.isdigit():
        if 4 <= len(cleaned) <= 5:
            return f"{int(cleaned)}.HK"
        if cleaned.startswith(("6", "9")):
            return f"{cleaned}.SH"
        return f"{cleaned}.SZ"
    return f"{cleaned}.US"
