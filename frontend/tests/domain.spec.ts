import { expect, test } from "@playwright/test";

import {
  apiIsoToDateTimeLocal,
  currentBusinessDateTimeLocal,
  dateTimeLocalToApiIso,
} from "../src/businessTime";
import { MAX_TRANSACTION_AMOUNT_CENTS, yuanTextToCents } from "../src/money";


test("money input keeps integer cents and enforces product bounds", () => {
  expect(yuanTextToCents("0.01")).toBe(1);
  expect(yuanTextToCents("12.60")).toBe(1260);
  expect(() => yuanTextToCents("0")).toThrow("金额必须大于 0 元");
  expect(() => yuanTextToCents("100000000")).toThrow("金额不能超过");
  expect(MAX_TRANSACTION_AMOUNT_CENTS).toBe(9_999_999_999);
});


test("API time and datetime-local convert through Asia/Shanghai without day drift", () => {
  expect(apiIsoToDateTimeLocal("2026-06-30T16:30:00Z")).toBe("2026-07-01T00:30");
  expect(apiIsoToDateTimeLocal("2026-07-01T00:30:00+08:00")).toBe("2026-07-01T00:30");
  expect(dateTimeLocalToApiIso("2026-07-01T00:30")).toBe("2026-07-01T00:30:00+08:00");
  expect(currentBusinessDateTimeLocal(new Date("2026-07-13T16:30:00Z"))).toBe("2026-07-14T00:30");
});
