def records(data: object) -> list[dict]:
    if hasattr(data, "to_dict"):
        extracted = data.to_dict("records")
        if isinstance(extracted, list):
            return [record for record in extracted if isinstance(record, dict)]
    if isinstance(data, list):
        return [record for record in data if isinstance(record, dict)]
    return []


def first_record(data: object) -> dict | None:
    extracted = records(data)
    return extracted[0] if extracted else None
