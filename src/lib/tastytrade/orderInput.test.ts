import { describe, it, expect } from "vitest";
import { validatePlaceOrder, validateCancelOrder } from "./orderInput";

const good = { accountNumber: "5WT00001", side: "BUY", shares: 10, price: 52.3 };

describe("validatePlaceOrder", () => {
  it("accepts a well-formed order", () => {
    expect(validatePlaceOrder(good)).toEqual({ ok: true, value: good });
  });

  it("coerces numeric strings (JSON from older callers)", () => {
    const r = validatePlaceOrder({ ...good, shares: "10", price: "52.30" });
    expect(r.ok && r.value.shares).toBe(10);
    expect(r.ok && r.value.price).toBe(52.3);
  });

  it.each([
    ["fractional shares", { shares: 2.5 }],
    ["zero shares", { shares: 0 }],
    ["negative shares", { shares: -5 }],
    ["non-numeric shares", { shares: "ten" }],
    ["missing shares", { shares: undefined }],
    ["zero price", { price: 0 }],
    ["negative price", { price: -1 }],
    ["NaN price", { price: "abc" }],
    ["missing price", { price: null }],
    ["bad side", { side: "SHORT" }],
    ["path in account number", { accountNumber: "5WT00001/../x" }],
    ["empty account number", { accountNumber: "" }],
  ])("rejects %s", (_label, patch) => {
    expect(validatePlaceOrder({ ...good, ...patch }).ok).toBe(false);
  });

  it("rejects a null body", () => {
    expect(validatePlaceOrder(null).ok).toBe(false);
  });
});

describe("validateCancelOrder", () => {
  it("accepts numeric or string order ids", () => {
    expect(validateCancelOrder({ accountNumber: "5WT00001", orderId: 123456 })).toEqual({
      ok: true,
      value: { accountNumber: "5WT00001", orderId: "123456" },
    });
    expect(validateCancelOrder({ accountNumber: "5WT00001", orderId: "123456" }).ok).toBe(true);
  });

  it("rejects ids that could alter the upstream path", () => {
    expect(validateCancelOrder({ accountNumber: "5WT00001", orderId: "1/../2" }).ok).toBe(false);
    expect(validateCancelOrder({ accountNumber: "5WT00001" }).ok).toBe(false);
  });
});
