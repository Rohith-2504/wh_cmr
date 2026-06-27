import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_TIMEZONE,
  DOW_SHORT_MON_FIRST,
  daysAgoStart,
  formatDateTime,
  formatTime,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from "./date-utils";

describe("startOfLocalDay", () => {
  it("zeroes out the time at IST midnight for a given instant", () => {
    const d = new Date("2026-05-18T08:15:22.500Z"); // 13:45 IST
    const out = startOfLocalDay(d);
    expect(out.toISOString()).toBe("2026-05-17T18:30:00.000Z");
  });

  it("does not mutate the input", () => {
    const d = new Date("2026-05-18T08:15:22.500Z");
    const before = d.getTime();
    startOfLocalDay(d);
    expect(d.getTime()).toBe(before);
  });
});

describe("daysAgoStart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T08:15:22.000Z")); // 13:45 IST on May 18
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns IST midnight N days before today", () => {
    const out = daysAgoStart(3);
    expect(out.toISOString()).toBe("2026-05-14T18:30:00.000Z");
  });

  it("daysAgoStart(0) is today at IST midnight", () => {
    const out = daysAgoStart(0);
    expect(out.toISOString()).toBe("2026-05-17T18:30:00.000Z");
  });

  it("crosses month boundaries cleanly", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00.000Z")); // May 2 13:30 IST
    const out = daysAgoStart(5);
    expect(out.toISOString()).toBe("2026-04-26T18:30:00.000Z");
  });
});

describe("localDayKey", () => {
  it("emits YYYY-MM-DD in IST", () => {
    expect(localDayKey(new Date("2026-01-09T18:29:00.000Z"))).toBe("2026-01-09");
  });

  it("rolls to the next IST calendar day after midnight UTC", () => {
    expect(localDayKey(new Date("2026-01-09T18:30:00.000Z"))).toBe("2026-01-10");
  });

  it("zero-pads month and day", () => {
    expect(localDayKey(new Date("2026-09-04T18:30:00.000Z"))).toBe("2026-09-05");
  });

  it("accepts ISO strings as input", () => {
    expect(localDayKey("2026-12-31T18:30:00.000Z")).toBe("2027-01-01");
  });
});

describe("lastNDayKeys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T08:30:00.000Z")); // May 18 IST
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns n consecutive chronological keys ending today", () => {
    expect(lastNDayKeys(3)).toEqual(["2026-05-16", "2026-05-17", "2026-05-18"]);
  });

  it("returns just today for n=1", () => {
    expect(lastNDayKeys(1)).toEqual(["2026-05-18"]);
  });

  it("rolls back across a month boundary", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00.000Z"));
    expect(lastNDayKeys(4)).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
    ]);
  });
});

describe("mondayIndex", () => {
  it("maps Monday → 0 and Sunday → 6 in IST", () => {
    expect(mondayIndex(new Date("2026-05-18T12:00:00.000Z"))).toBe(0); // Mon
    expect(mondayIndex(new Date("2026-05-19T12:00:00.000Z"))).toBe(1); // Tue
    expect(mondayIndex(new Date("2026-05-23T12:00:00.000Z"))).toBe(5); // Sat
    expect(mondayIndex(new Date("2026-05-24T12:00:00.000Z"))).toBe(6); // Sun
  });

  it("aligns with DOW_SHORT_MON_FIRST labels", () => {
    expect(DOW_SHORT_MON_FIRST[mondayIndex(new Date("2026-05-18T12:00:00.000Z"))]).toBe(
      "Mon",
    );
    expect(DOW_SHORT_MON_FIRST[mondayIndex(new Date("2026-05-24T12:00:00.000Z"))]).toBe(
      "Sun",
    );
  });
});

describe("formatDateTime", () => {
  it("formats in IST with 24-hour clock", () => {
    const out = formatDateTime("2026-05-18T09:00:00.000Z"); // 14:30 IST
    expect(out).toMatch(/14:30/);
    expect(out).not.toMatch(/PM|AM/i);
  });

  it("uses Asia/Kolkata timezone", () => {
    expect(APP_TIMEZONE).toBe("Asia/Kolkata");
  });
});

describe("formatTime", () => {
  it("returns 24-hour time without AM/PM", () => {
    expect(formatTime("2026-05-18T09:00:00.000Z")).toMatch(/14:30/);
  });
});
