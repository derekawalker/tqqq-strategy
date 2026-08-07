import { describe, it, expect } from "vitest";
import { vxnBand, brokerHealthPayload } from "./route";

describe("brokerHealthPayload", () => {
  it("alerts once when the link goes down", () => {
    expect(brokerHealthPayload(false, true)?.title).toBe("Schwab connection lost");
  });

  it("stays quiet while it is still down", () => {
    expect(brokerHealthPayload(true, true)).toBeNull();
  });

  it("says so when it comes back", () => {
    expect(brokerHealthPayload(true, false)?.title).toBe("Schwab reconnected");
  });

  it("stays quiet while it is healthy", () => {
    expect(brokerHealthPayload(false, false)).toBeNull();
  });

  it("points at the app, where the reconnect button lives", () => {
    expect(brokerHealthPayload(false, true)?.url).toBe("/");
  });

  it("reuses one tag, so an outage replaces its own notification", () => {
    expect(brokerHealthPayload(false, true)?.tag).toBe(
      brokerHealthPayload(true, false)?.tag,
    );
  });
});

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
