import { describe, it, expect } from "vitest";
import { snapToListedStrike, strikesNearestExpiry } from "./chains";

describe("snapToListedStrike", () => {
  it("returns the ideal strike unchanged when no listed strikes are available", () => {
    expect(snapToListedStrike(62.5, [])).toBe(62.5);
  });

  it("snaps to the nearest listed strike within the snap distance", () => {
    expect(snapToListedStrike(62.5, [60, 63, 66])).toBe(63);
    expect(snapToListedStrike(60.5, [60, 63, 66])).toBe(60);
  });

  it("breaks ties toward the lower strike", () => {
    expect(snapToListedStrike(60.5, [60, 61])).toBe(60);
  });

  it("leaves the ideal strike unchanged when the nearest listed strike is too far away", () => {
    // Guards against a sparse/malformed chain response snapping unrelated
    // ladder rungs onto the same distant strike and collapsing many rows.
    expect(snapToListedStrike(61.2, [60, 63, 66])).toBe(61.2);
    expect(snapToListedStrike(61.5, [60, 63])).toBe(61.5);
  });
});

describe("strikesNearestExpiry", () => {
  it("picks the expiry whose DTE is closest to the target and dedupes strikes", () => {
    const data = {
      callExpDateMap: {
        "2026-07-10:8": { "60.0": [], "61.0": [] },
        "2026-07-17:15": { "60.0": [], "62.0": [] },
      },
      putExpDateMap: {
        "2026-07-10:8": { "59.0": [], "61.0": [] },
      },
    };
    expect(strikesNearestExpiry(data, 7)).toEqual([59, 60, 61]);
  });

  it("returns [] when there are no expirations", () => {
    expect(strikesNearestExpiry({}, 7)).toEqual([]);
  });
});
