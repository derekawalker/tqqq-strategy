import { describe, it, expect } from "vitest";
import { vxnBand } from "./route";

describe("vxnBand", () => {
  it("classifies calm, elevated, high, and panic bands at their boundaries", () => {
    expect(vxnBand(10)).toBe("calm");
    expect(vxnBand(24.9)).toBe("calm");
    expect(vxnBand(25)).toBe("elevated");
    expect(vxnBand(34.9)).toBe("elevated");
    expect(vxnBand(35)).toBe("high"); // PUT_SPREAD_VXN_THRESHOLD
    expect(vxnBand(49.9)).toBe("high");
    expect(vxnBand(50)).toBe("panic"); // VIX_PAUSE_THRESHOLD
    expect(vxnBand(80)).toBe("panic");
  });
});
