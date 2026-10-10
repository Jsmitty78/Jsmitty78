/**
 * Display formatting only. Every number shown here was computed by the server; the UI converts
 * units and rounds for reading, and says so (DISPLAY_ROUNDING). An unknown value is never shown as 0.
 */
export interface Quantity { value: number | null; unit: string; reason?: string | null; reasons?: string[]; basis?: string }

export const DISPLAY_ROUNDING = "Lengths are shown to the nearest 1/16 in with millimetres to the nearest 1 mm. The server calculates in metres without rounding.";
export const UNKNOWN = "Unknown";

const METRES: Record<string, number> = { m: 1, mm: 0.001, cm: 0.01, ft: 0.3048, in: 0.0254 };

export function toMetres(value: number | null | undefined, unit: string): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = METRES[unit];
  return factor === undefined ? null : value * factor;
}

export function isKnown(q: Quantity | null | undefined): q is Quantity & { value: number } {
  return !!q && q.value !== null && Number.isFinite(q.value) && q.basis !== "unknown";
}

export function unknownReason(q: Quantity | null | undefined): string {
  if (!q) return "Not reported by the server";
  return q.reason ?? q.reasons?.[0] ?? "Not reported by the server";
}

const FRACTIONS = ["", "1/16", "1/8", "3/16", "1/4", "5/16", "3/8", "7/16", "1/2", "9/16", "5/8", "11/16", "3/4", "13/16", "7/8", "15/16"];

/** 2.4479 m -> 8′-0 3/8″ (nearest 1/16 in). */
export function feetInches(metres: number, signed = false): string {
  const sixteenths = Math.round(Math.abs(metres) / 0.0254 * 16);
  const sign = metres < 0 && sixteenths > 0 ? "−" : signed ? "+" : "";
  const feet = Math.floor(sixteenths / 192);
  const rest = sixteenths - feet * 192;
  const inches = Math.floor(rest / 16);
  const frac = FRACTIONS[rest % 16];
  const inchText = `${inches}${frac ? ` ${frac}` : ""}″`;
  return feet > 0 ? `${sign}${feet}′-${inchText}` : `${sign}${inchText}`;
}

export function millimetres(metres: number, signed = false): string {
  const mm = Math.round(metres * 1000);
  const sign = mm < 0 ? "−" : signed && mm > 0 ? "+" : "";
  return `${sign}${Math.abs(mm).toLocaleString("en-US")} mm`;
}

export interface LengthText { known: true; primary: string; secondary: string }
export interface UnknownText { known: false; primary: string; reason: string }

/** A length quantity from the server (m, mm, ft or in) as ft-in plus mm, or "Unknown" with the server's reason. */
export function lengthText(q: Quantity | null | undefined, signed = false): LengthText | UnknownText {
  const metres = isKnown(q) ? toMetres(q.value, q.unit) : null;
  if (metres === null) return { known: false, primary: UNKNOWN, reason: unknownReason(q) };
  return { known: true, primary: feetInches(metres, signed), secondary: millimetres(metres, signed) };
}

export function metresText(metres: number | null | undefined, signed = false): LengthText | UnknownText {
  return lengthText(metres === null || metres === undefined ? null : { value: metres, unit: "m" }, signed);
}

/** Counts: "5 each", "Unknown". */
export function countText(q: Quantity | null | undefined): string {
  if (!isKnown(q)) return UNKNOWN;
  const unit = q.unit === "each" ? "" : ` ${q.unit}`;
  return `${Number.isInteger(q.value) ? q.value : q.value.toFixed(2)}${unit}`;
}

export function signedCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNKNOWN;
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
}

/**
 * Parse a length typed by the user into millimetres. Accepts 10' 2-1/2", 10'2", 122.5", 3100 mm, 3.1 m,
 * or a bare number in the given default unit. Returns null when the text is not a length.
 */
export function parseLength(text: string, defaultUnit: "mm" | "in" = "mm"): number | null {
  const t = text.trim().replace(/[−–]/g, "-").replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/\s+/g, " ");
  if (!t) return null;
  const metric = /^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)$/i.exec(t);
  if (metric) return Number(metric[1]) * ({ mm: 1, cm: 10, m: 1000 } as const)[metric[2].toLowerCase() as "mm" | "cm" | "m"];
  const imperial = /^(-)?(?:(\d+(?:\.\d+)?)\s*(?:'|ft)\s*-?\s*)?(?:(\d+(?:\.\d+)?)?(?:[ -]?(\d+)\/(\d+))?\s*(?:"|in)?)?$/i.exec(t);
  const hasUnitMark = /'|"|ft|in/i.test(t);
  if (imperial && hasUnitMark) {
    const [, neg, ft, inch, num, den] = imperial;
    if (!ft && !inch && !num) return null;
    if (den !== undefined && Number(den) === 0) return null;
    const inches = Number(ft ?? 0) * 12 + Number(inch ?? 0) + (num ? Number(num) / Number(den) : 0);
    return (neg ? -1 : 1) * inches * 25.4;
  }
  const bare = /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
  if (bare === null) return null;
  return defaultUnit === "mm" ? bare : bare * 25.4;
}

/** mm -> the text the user would type back in the chosen unit. */
export function lengthInput(mm: number | null | undefined, unit: "mm" | "in"): string {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return "";
  if (unit === "mm") return String(Math.round(mm * 10) / 10);
  return feetInches(mm / 1000).replace("″", '"').replace("′", "'");
}

const PRODUCTS: Record<string, { short: string; long: string }> = {
  "spears/CP-010": { short: "CPVC pipe NPS 1", long: "Spears FlameGuard CP-010 CPVC pipe, NPS 1" },
  "spears/4206-010S": { short: "90° elbow NPS 1", long: "Spears FlameGuard 4206-010S sweep 90° elbow, socket" },
  "spears/FS-5": { short: "FS-5 cement", long: "Spears FS-5 one-step solvent cement" },
};
export function productName(id: string | null | undefined, long = false): string {
  if (!id) return "No product";
  const p = PRODUCTS[id];
  return p ? (long ? p.long : p.short) : id;
}
export function productCode(id: string | null | undefined): string {
  return id ? id.replace(/^spears\//, "") : "—";
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
