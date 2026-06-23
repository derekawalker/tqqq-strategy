import { describe, it, expect } from "vitest";
import { occSymbol, humanContract } from "./optionSymbol";

describe("occSymbol", () => {
  it("pads root to 6 and encodes date/type/strike", () => {
    expect(occSymbol("QQQ", "2026-08-21", "P", 553)).toBe("QQQ   260821P00553000");
    expect(occSymbol("QQQ", "2026-08-21", "P", 480)).toBe("QQQ   260821P00480000");
  });

  it("handles fractional strikes and 4-letter roots", () => {
    expect(occSymbol("QQQ", "2026-08-21", "P", 552.5)).toBe("QQQ   260821P00552500");
    expect(occSymbol("SPXW", "2026-12-18", "C", 6000)).toBe("SPXW  261218C06000000");
  });
});

describe("humanContract", () => {
  it("formats a readable label", () => {
    expect(humanContract("QQQ", "2026-08-21", "P", 553)).toBe("QQQ Aug 21 '26 $553 P");
    expect(humanContract("QQQ", "2026-01-16", "P", 480)).toBe("QQQ Jan 16 '26 $480 P");
  });

  it("keeps the decimal on fractional strikes", () => {
    expect(humanContract("QQQ", "2026-08-21", "P", 552.5)).toBe("QQQ Aug 21 '26 $552.5 P");
  });
});
