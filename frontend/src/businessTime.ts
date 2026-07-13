export const BUSINESS_TIME_ZONE = "Asia/Shanghai";

function shanghaiParts(date: Date): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function currentBusinessDateTimeLocal(now = new Date()): string {
  const parts = shanghaiParts(now);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function currentBusinessIso(now = new Date()): string {
  return `${currentBusinessDateTimeLocal(now)}:00+08:00`;
}

export function apiIsoToDateTimeLocal(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) {
    const localMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(trimmed);
    if (!localMatch) throw new Error("交易时间格式不正确");
    return `${localMatch[1]}T${localMatch[2]}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw new Error("交易时间格式不正确");
  return currentBusinessDateTimeLocal(parsed);
}

export function dateTimeLocalToApiIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("请选择完整的交易时间");
  const [, year, month, day, hour, minute] = match;
  const probe = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
  if (Number.isNaN(probe.getTime())) throw new Error("交易时间格式不正确");
  return `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
}

export function businessDateKey(value: string): string {
  return apiIsoToDateTimeLocal(value).slice(0, 10);
}

export function businessTimeLabel(value: string): string {
  return apiIsoToDateTimeLocal(value).slice(11, 16);
}
