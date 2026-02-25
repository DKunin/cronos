"use strict";

const moment = require("moment");
require("moment/locale/ru"); // Load Russian locale

function formatDate(dateStr) {
  return moment(dateStr, [
    "DD/MM/YYYY",
    "YYYY-MM-DD",
    "MM-DD-YYYY",
    "DD.MM.YYYY",
  ])
    .locale("ru")
    .format("dddd, D MMMM");
}

function parseCalendarIdsFromEnv(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((id) => String(id).trim()).filter(Boolean);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((id) => String(id).trim()).filter(Boolean);
      }
    } catch (error) {
      console.warn(
        "Failed to parse CALENDAR_IDS as JSON. Falling back to comma separation."
      );
    }
  }

  return trimmed.split(",").map((id) => id.trim()).filter(Boolean);
}

function getEventStartDate(event) {
  if (event.start?.dateTime) {
    return new Date(event.start.dateTime);
  }

  if (event.start?.date) {
    return new Date(event.start.date);
  }

  return null;
}

function eventContainsDateKeywords(eventDetails) {
  if (!eventDetails) {
    return false;
  }

  const keywords = ["кино", "театр", "дима с катей на"];
  const normalizedFields = [
    eventDetails.summary,
    eventDetails.description,
    eventDetails.location,
  ]
    .filter(Boolean)
    .map((field) => field.toLowerCase());

  return normalizedFields.some((field) =>
    keywords.some((keyword) => field.includes(keyword))
  );
}

module.exports = {
  eventContainsDateKeywords,
  formatDate,
  getEventStartDate,
  parseCalendarIdsFromEnv,
};
