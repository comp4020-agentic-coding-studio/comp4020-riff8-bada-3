import { describe, expect, it } from "vitest";
import { weekLabel, weekOf } from "../src/week.ts";

// Pure: no server involved. Sydney is +10 (AEST) or +11 (AEDT); DST began at
// 02:00 on Sunday 4 Oct 2026 and ended at 03:00 on Sunday 5 Apr 2026.
const at = (iso: string) => weekOf(new Date(iso));

describe("weekOf", () => {
  it("puts Sunday 23:59 and Monday 00:00 (Sydney) in different weeks", () => {
    // AEDT: Monday 12 Oct 00:00 is 11 Oct 13:00Z
    expect(at("2026-10-11T12:59:00Z").start).toBe("2026-10-05");
    expect(at("2026-10-11T13:00:00Z").start).toBe("2026-10-12");
    expect(at("2026-10-11T13:00:00Z").startsAt.toISOString()).toBe("2026-10-11T13:00:00.000Z");
  });

  it("handles a Monday boundary in standard time (+10)", () => {
    // AEST: Monday 6 Jul 2026 00:00 is 5 Jul 14:00Z
    expect(at("2026-07-05T13:59:59Z").start).toBe("2026-06-29");
    expect(at("2026-07-05T14:00:00Z").start).toBe("2026-07-06");
    expect(at("2026-07-05T14:00:00Z").startsAt.toISOString()).toBe("2026-07-05T14:00:00.000Z");
  });

  it("starts the week DST begins at the +10 midnight that preceded it", () => {
    // Monday 28 Sep 2026 00:00 was AEST; Sunday 4 Oct moved to AEDT mid-week.
    expect(at("2026-10-04T12:00:00Z").start).toBe("2026-09-28");
    expect(at("2026-10-04T12:00:00Z").startsAt.toISOString()).toBe("2026-09-27T14:00:00.000Z");
  });

  it("starts the first week after DST begins at the +11 midnight", () => {
    expect(at("2026-10-04T12:59:59Z").start).toBe("2026-09-28");
    expect(at("2026-10-04T13:00:00Z").start).toBe("2026-10-05");
    expect(at("2026-10-07T00:00:00Z").startsAt.toISOString()).toBe("2026-10-04T13:00:00.000Z");
  });

  it("handles the April transition back to standard time", () => {
    // Monday 30 Mar 2026 00:00 was AEDT; Monday 6 Apr 00:00 is AEST.
    expect(at("2026-04-05T13:59:59Z").start).toBe("2026-03-30");
    expect(at("2026-04-05T13:59:59Z").startsAt.toISOString()).toBe("2026-03-29T13:00:00.000Z");
    expect(at("2026-04-05T14:00:00Z").start).toBe("2026-04-06");
    expect(at("2026-04-05T14:00:00Z").startsAt.toISOString()).toBe("2026-04-05T14:00:00.000Z");
  });

  it("treats a UTC Sunday that's already Monday in Sydney as the new week", () => {
    expect(at("2026-10-11T20:00:00Z").start).toBe("2026-10-12");
  });
});

describe("weekLabel", () => {
  it("names the week by its Monday", () => {
    expect(weekLabel("2026-10-05")).toBe("Week of 5 Oct 2026");
    expect(weekLabel("2026-09-28")).toBe("Week of 28 Sep 2026");
  });
});
