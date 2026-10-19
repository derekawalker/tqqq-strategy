import { describe, it, expect } from "vitest";
import { flattenOrders, type RawSchwabOrder } from "./parse";

const order = (orderId: number, children: RawSchwabOrder[] = []): RawSchwabOrder =>
  ({ orderId, enteredTime: "", childOrderStrategies: children }) as unknown as RawSchwabOrder;

describe("flattenOrders", () => {
  it("lists parents and their nested children", () => {
    const ids = flattenOrders([order(1, [order(2, [order(3)])]), order(4)]).map((o) => o.orderId);
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it("keeps one copy of an order that arrives both nested and top-level", () => {
    // Adjacent date windows: one returns the child under its trigger parent, the next returns it alone
    const ids = flattenOrders([order(1, [order(2)]), order(2)]).map((o) => o.orderId);
    expect(ids).toEqual([1, 2]);
  });
});
