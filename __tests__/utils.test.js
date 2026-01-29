"use strict";

const {
  eventContainsDateKeywords,
  formatDate,
  getEventStartDate,
  parseCalendarIdsFromEnv,
} = require("../utils");

describe("parseCalendarIdsFromEnv", () => {
  it("returns empty array for empty input", () => {
    expect(parseCalendarIdsFromEnv("")).toEqual([]);
    expect(parseCalendarIdsFromEnv()).toEqual([]);
  });

  it("parses comma-separated values", () => {
    expect(parseCalendarIdsFromEnv("one,two , three")).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("parses JSON array strings", () => {
    expect(parseCalendarIdsFromEnv('["one","two"]')).toEqual(["one", "two"]);
  });

  it("handles arrays as input", () => {
    expect(parseCalendarIdsFromEnv(["one", " two "])).toEqual(["one", "two"]);
  });
});

describe("getEventStartDate", () => {
  it("returns dateTime when available", () => {
    const event = { start: { dateTime: "2024-01-01T10:00:00Z" } };
    expect(getEventStartDate(event).toISOString()).toBe(
      "2024-01-01T10:00:00.000Z"
    );
  });

  it("returns date for all-day events", () => {
    const event = { start: { date: "2024-01-02" } };
    expect(getEventStartDate(event).toISOString()).toBe(
      "2024-01-02T00:00:00.000Z"
    );
  });

  it("returns null when start is missing", () => {
    expect(getEventStartDate({})).toBeNull();
  });
});

describe("eventContainsDateKeywords", () => {
  it("detects keywords across fields", () => {
    const eventDetails = {
      summary: "Поход в кино",
      description: "",
      location: "",
    };
    expect(eventContainsDateKeywords(eventDetails)).toBe(true);
  });

  it("returns false when no keywords are present", () => {
    const eventDetails = {
      summary: "Work meeting",
      description: "Discuss quarterly goals",
      location: "Office",
    };
    expect(eventContainsDateKeywords(eventDetails)).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(eventContainsDateKeywords(null)).toBe(false);
  });
});

describe("formatDate", () => {
  it("formats date string using Russian locale", () => {
    expect(formatDate("2024-01-01")).toBe("понедельник, 1 января");
  });
});
