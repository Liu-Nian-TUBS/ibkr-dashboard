import type { ApiRecord } from "./contracts";

export function asRecord(value: unknown): ApiRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ApiRecord) : {};
}

export function asArray(value: unknown): ApiRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as ApiRecord[] : [];
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = asNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

export function asText(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function formatNumber(value: unknown, digits = 2): string {
  const parsed = asOptionalNumber(value);
  if (parsed === null) return "-";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(parsed);
}

export function formatInteger(value: unknown): string {
  const parsed = asOptionalNumber(value);
  if (parsed === null) return "-";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(parsed);
}

export function formatCurrency(value: unknown, currency = "USD", digits = 2): string {
  const parsed = asOptionalNumber(value);
  if (parsed === null) return "-";
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const customSymbol = currencySymbol(normalizedCurrency);
  if (customSymbol) {
    const sign = parsed < 0 ? "-" : "";
    return `${sign}${customSymbol}${formatNumber(Math.abs(parsed), digits)}`;
  }
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: normalizedCurrency,
      currencyDisplay: "symbol",
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(parsed);
  } catch {
    return `${normalizedCurrency} ${formatNumber(parsed, digits)}`;
  }
}

export function formatPercent(value: unknown, digits = 2): string {
  const parsed = asOptionalNumber(value);
  if (parsed === null) return "-";
  return `${formatNumber(parsed * 100, digits)}%`;
}

export function formatDate(value: unknown): string {
  const text = asText(value, "");
  if (!text) return "-";
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

export function formatDateTimeMinute(value: unknown): string {
  const text = asText(value, "");
  if (!text) return "-";
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{8};\d{4,6}$/.test(text)) {
    const datePart = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    const timeDigits = text.slice(9).padEnd(6, "0");
    return `${datePart} ${timeDigits.slice(0, 2)}:${timeDigits.slice(2, 4)}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const datePart = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(parsed)
      .replace(/\//g, "-");
    const timePart = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(parsed);
    return `${datePart} ${timePart}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.slice(0, 16).replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

export function formatMonth(value: unknown): string {
  const text = asText(value, "");
  if (/^\d{6}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
  return text || "-";
}

export function deltaClass(value: unknown): "positive" | "negative" | "neutral" {
  const parsed = asNumber(value, 0);
  if (parsed > 0) return "positive";
  if (parsed < 0) return "negative";
  return "neutral";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sortRecords(records: ApiRecord[], key: string, direction: "asc" | "desc"): ApiRecord[] {
  return [...records].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    const leftNumber = asOptionalNumber(left);
    const rightNumber = asOptionalNumber(right);
    let compare = 0;
    if (leftNumber !== null && rightNumber !== null) {
      compare = leftNumber - rightNumber;
    } else {
      compare = asText(left, "").localeCompare(asText(right, ""));
    }
    return direction === "asc" ? compare : -compare;
  });
}

export function getCurrency(record: ApiRecord, fallback = "USD"): string {
  return asText(record.display_currency ?? record.currency ?? record.notional_currency, fallback);
}

function normalizeCurrencyCode(currency: string): string {
  const code = (currency || "USD").toUpperCase();
  if (code === "RMB") return "CNY";
  return code;
}

function currencySymbol(currency: string): string | null {
  if (currency === "USD") return "$";
  if (currency === "HKD") return "HK$";
  if (currency === "CNY") return "¥";
  if (currency === "CNH") return "CN¥";
  return null;
}
