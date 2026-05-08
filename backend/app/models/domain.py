from dataclasses import dataclass, field

from app.models.xml_models import (
    AccountSnapshotRecord,
    CashTransactionRecord,
    FxRateRecord,
    PositionSnapshotRecord,
    StatementFundsLineRecord,
    TradeRecord,
)


@dataclass(slots=True)
class ParsedXmlData:
    trades: list[TradeRecord] = field(default_factory=list)
    cash_transactions: list[CashTransactionRecord] = field(default_factory=list)
    account_snapshots: list[AccountSnapshotRecord] = field(default_factory=list)
    positions: list[PositionSnapshotRecord] = field(default_factory=list)
    statement_funds_lines: list[StatementFundsLineRecord] = field(default_factory=list)
    fx_rates: list[FxRateRecord] = field(default_factory=list)
