import { currentBusinessDateTimeLocal } from "./businessTime";

export const MAX_TRANSACTION_AMOUNT_CENTS = 9_999_999_999;

export function centsToYuan(cents: number): string {
  return (cents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function yuanTextToCents(text: string): number {
  const match = text.trim().match(/^\d+(\.\d{1,2})?$/);
  if (!match) {
    throw new Error("请输入正确金额，例如 19.90");
  }
  const [yuan, cent = ""] = text.trim().split(".");
  const amountCents = Number(yuan) * 100 + Number(cent.padEnd(2, "0"));
  if (amountCents <= 0) throw new Error("金额必须大于 0 元");
  if (amountCents > MAX_TRANSACTION_AMOUNT_CENTS) {
    throw new Error("金额不能超过 99,999,999.99 元");
  }
  return amountCents;
}

export function monthKey(date = new Date()): string {
  return currentBusinessDateTimeLocal(date).slice(0, 7);
}

export function isoWeekKey(date = new Date()): string {
  const [year, month, day] = currentBusinessDateTimeLocal(date).slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day));
  const weekday = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - weekday);
  const isoYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(weekNumber).padStart(2, "0")}`;
}

export function isoWeekRange(weekKey: string): { start: string; end: string } {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return isoWeekRange(isoWeekKey());

  const year = Number(match[1]);
  const week = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthWeekday = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - januaryFourthWeekday + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}
