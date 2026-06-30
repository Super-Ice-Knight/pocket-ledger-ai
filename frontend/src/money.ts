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
  return Number(yuan) * 100 + Number(cent.padEnd(2, "0"));
}

export function monthKey(date = new Date()): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

