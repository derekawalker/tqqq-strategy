import { describe, it, expect } from "vitest";
import { percentileRank, ivRankGuidance } from "./ivRank";

describe("percentileRank", () => {
  it("returns 100 when the latest value is the highest in the window", () => {
    expect(percentileRank([10, 20, 15, 30])).toBe(100);
  });

  it("returns 0 when the latest value is the lowest in the window", () => {
    expect(percentileRank([10, 20, 15, 5])).toBe(0);
  });

  it("returns ~50 for a middle value in a uniform spread", () => {
    // 5 distinct values, latest (30) is the 3rd of 5 (rank 3 -> (3-1)/(5-1)*100 = 50)
    expect(percentileRank([40, 20, 10, 50, 30])).toBeCloseTo(50, 5);
  });

  it("only looks at the trailing window, not the full history", () => {
    // First value (1000) would dominate if included; window=3 excludes it.
    const values = [1000, 10, 20, 15];
    expect(percentileRank(values, 3)).toBeLessThan(100);
  });

  it("returns null with fewer than 2 values", () => {
    expect(percentileRank([])).toBeNull();
    expect(percentileRank([42])).toBeNull();
  });
});

describe("ivRankGuidance", () => {
  it("classifies rich/normal/thin per thresholds", () => {
    expect(ivRankGuidance(75)).toBe("rich");
    expect(ivRankGuidance(51)).toBe("rich");
    expect(ivRankGuidance(50)).toBe("normal");
    expect(ivRankGuidance(20)).toBe("normal");
    expect(ivRankGuidance(19)).toBe("thin");
    expect(ivRankGuidance(0)).toBe("thin");
  });

  it("defaults to normal when rank is unknown", () => {
    expect(ivRankGuidance(null)).toBe("normal");
  });
});
