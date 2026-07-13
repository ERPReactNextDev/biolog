export const PH_TZ = "Asia/Manila";

export function getPHParts(input?: Date | string | number) {
  const d = input === undefined ? new Date()
    : typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: PH_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, weekday: "short",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const hourRaw = get("hour");
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: hourRaw === "24" ? 0 : Number(hourRaw),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

export function toDateKeyPH(input?: Date | string | number): string {
  const { year, month, day } = getPHParts(input);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getPHHour(input?: Date | string | number): number {
  return getPHParts(input).hour;
}

export function isSamePHDay(a: Date | string | number, b: Date | string | number): boolean {
  return toDateKeyPH(a) === toDateKeyPH(b);
}

export function setPHTime(baseDate: Date | string | number, hh: number, mm: number): Date {
  const { year, month, day } = getPHParts(baseDate);
  return new Date(Date.UTC(year, month - 1, day, hh - 8, mm, 0, 0));
}

export function phMidnight(year: number, month1to12: number, day: number): Date {
  return new Date(Date.UTC(year, month1to12 - 1, day, -8, 0, 0, 0));
}

export function formatPHDate(input: Date | string | number, options: Intl.DateTimeFormatOptions = {}) {
  const d = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  return d.toLocaleDateString("en-PH", { ...options, timeZone: PH_TZ });
}

export function formatPHTimeStr(input: Date | string | number, options: Intl.DateTimeFormatOptions = {}) {
  const d = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  return d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true, ...options, timeZone: PH_TZ });
}

export function formatPHDateTime(input: Date | string | number, options: Intl.DateTimeFormatOptions = {}) {
  const d = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  return d.toLocaleString("en-PH", { ...options, timeZone: PH_TZ });
}

export function phTodayAsLocalDate(): Date {
  const { year, month, day } = getPHParts(new Date());
  return new Date(year, month - 1, day);
}