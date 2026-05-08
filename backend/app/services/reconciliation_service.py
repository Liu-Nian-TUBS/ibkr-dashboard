from dataclasses import dataclass, field


@dataclass(slots=True)
class ReconciliationResult:
    status: str
    diffs: list[dict] = field(default_factory=list)


class ReconciliationService:
    def compare(self, left: dict, right: dict) -> ReconciliationResult:
        diffs: list[dict] = []
        for key, left_value in left.items():
            right_value = right.get(key)
            if right_value != left_value:
                diffs.append({"field": key, "left": left_value, "right": right_value})
        status = "passed" if not diffs else "failed"
        return ReconciliationResult(status=status, diffs=diffs)
