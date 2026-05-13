"use strict";

const { google } = require("googleapis");
const cron = require("node-cron");
const dotenv = require("dotenv");
const fs = require("fs");
const {
  eventContainsDateKeywords,
  formatDate,
  getEventStartDate,
  parseCalendarIdsFromEnv,
} = require("./utils");

dotenv.config();

// Load service account credentials
const serviceAccount = JSON.parse(fs.readFileSync("cronus.json", "utf8"));

// Google Calendar settings
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

const calendarEnv =
  process.env.CALENDAR_IDS || process.env.CALENDAR_ID || "primary";
const calendarEnvSource = process.env.CALENDAR_IDS
  ? "CALENDAR_IDS"
  : process.env.CALENDAR_ID
  ? "CALENDAR_ID"
  : "default";
const parsedCalendarIds = parseCalendarIdsFromEnv(calendarEnv);
const calendarIds =
  parsedCalendarIds.length > 0
    ? Array.from(new Set(parsedCalendarIds))
    : ["primary"];

// Notification webhook settings
const DEFAULT_NOTIFICATION_WEBHOOK_URL =
  "https://n8n.kunini.ru/webhook/489ce88c-f9e9-43ec-a36c-e5b787f6a287";
const notificationWebhookUrl =
  process.env.NOTIFICATION_WEBHOOK_URL || DEFAULT_NOTIFICATION_WEBHOOK_URL;

function getRuntimeTimeZone() {
  return (
    process.env.TZ ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "system default"
  );
}

function getUrlHost(value) {
  try {
    return new URL(value).host;
  } catch (error) {
    return "invalid-url";
  }
}

function log(level, message, details) {
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;

  if (details) {
    console[method](prefix, JSON.stringify(details, null, 2));
    return;
  }

  console[method](prefix);
}

function serializeError(error) {
  const responseData = error.response?.data;
  const googleError = responseData?.error || responseData;
  const serialized = {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.response?.status,
    statusText: error.response?.statusText,
    calendarId: error.calendarId,
    googleError,
  };

  if (error.calendarFailures) {
    serialized.calendarFailures = error.calendarFailures;
  }

  return Object.fromEntries(
    Object.entries(serialized).filter(([, value]) => value !== undefined)
  );
}

function serializeEventForLog(event) {
  return {
    id: event.id,
    status: event.status,
    summary: event.summary || "(no summary)",
    sourceCalendarId: event.sourceCalendarId,
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null,
    location: event.location || null,
    organizer: event.organizer?.displayName || event.organizer?.email || null,
    htmlLink: event.htmlLink || null,
  };
}

function logError(message, error, context = {}) {
  log("error", message, {
    ...context,
    error: serializeError(error),
  });
}

// Authenticate Google API client
const googleAuth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: SCOPES,
  projectId: serviceAccount.project_id,
});

const quotaProjectId =
  serviceAccount.quota_project_id || serviceAccount.project_id;
if (quotaProjectId) {
  google.options({ quotaProjectId });
}

let authClientPromise;
function getAuthClient() {
  if (!authClientPromise) {
    authClientPromise = googleAuth.getClient();
  }

  return authClientPromise;
}

const calendar = google.calendar({ version: "v3" });

/**
 * Fetch today's events from Google Calendar
 */
async function fetchEventsForCalendar(calendarId, timeMin, timeMax) {
  const request = {
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    showDeleted: false,
    maxResults: 2500,
    timeZone: getRuntimeTimeZone(),
  };

  log("info", "Google Calendar events.list request", request);

  try {
    const startedAt = Date.now();
    const authClient = await getAuthClient();
    const response = await calendar.events.list({
      auth: authClient,
      ...request,
    });
    const items = (response.data.items || []).map((event) => ({
      ...event,
      sourceCalendarId: calendarId,
    }));

    log("info", "Google Calendar events.list response", {
      calendarId,
      status: response.status,
      itemCount: items.length,
      resultTimeZone: response.data.timeZone,
      elapsedMs: Date.now() - startedAt,
    });

    return items;
  } catch (error) {
    error.calendarId = calendarId;
    throw error;
  }
}

async function getEventsInRange(timeMin, timeMax) {
  const results = await Promise.allSettled(
    calendarIds.map((calendarId) =>
      fetchEventsForCalendar(calendarId, timeMin, timeMax)
    )
  );

  const events = [];
  const failures = [];

  results.forEach((result, index) => {
    const calendarId = calendarIds[index];

    if (result.status === "fulfilled") {
      events.push(...result.value);
      return;
    }

    const failure = {
      calendarId,
      error: serializeError(result.reason),
    };
    failures.push(failure);
    logError("Google Calendar events.list failed", result.reason, {
      calendarId,
      timeMin,
      timeMax,
    });
  });

  if (failures.length > 0) {
    const error = new Error(
      `Failed to fetch ${failures.length}/${calendarIds.length} calendar(s).`
    );
    error.calendarFailures = failures;

    if (failures.length === calendarIds.length) {
      throw error;
    }

    log("warn", "Continuing with partial Google Calendar results", {
      failedCalendars: failures.length,
      successfulCalendars: calendarIds.length - failures.length,
      eventCount: events.length,
    });
  }

  return events
    .sort((a, b) => {
      const first = getEventStartDate(a)?.getTime() || 0;
      const second = getEventStartDate(b)?.getTime() || 0;
      return first - second;
    });
}

async function getTodayEvents() {
  const now = new Date();
  const startOfDay = new Date(now.setHours(0, 0, 0, 0)).toISOString();
  const endOfDay = new Date(now.setHours(23, 59, 59, 999)).toISOString();

  return getEventsInRange(startOfDay, endOfDay);
}

async function getUpcomingEvents() {
  const now = new Date();
  const startOfDay = new Date(now.setHours(0, 0, 0, 0)).toISOString();

  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 3);
  const endOfDay = new Date(futureDate.setHours(23, 59, 59, 999)).toISOString();

  log("info", "Fetching upcoming events", {
    calendarIds,
    calendarEnvSource,
    timeMin: startOfDay,
    timeMax: endOfDay,
    runtimeTimeZone: getRuntimeTimeZone(),
  });

  return getEventsInRange(startOfDay, endOfDay);
}

async function getEventDetails(calendarId, eventId) {
  try {
    const authClient = await getAuthClient();
    const response = await calendar.events.get({
      auth: authClient,
      calendarId,
      eventId,
    });
    return response.data;
  } catch (error) {
    error.calendarId = calendarId;
    logError("Google Calendar events.get failed", error, {
      calendarId,
      eventId,
    });
    return null;
  }
}

/**
 * Send a notification via webhook
 */
async function sendWebhookMessage(message) {
  try {
    const response = await fetch(notificationWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: message }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(
        `Webhook returned ${response.status} ${response.statusText}: ${responseBody}`
      );
    }

    console.log("Webhook notification sent!");
  } catch (error) {
    logError("Error sending webhook message", error, {
      webhookHost: getUrlHost(notificationWebhookUrl),
    });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch events and send webhook notifications
 */
async function runJob() {
  log("info", "Checking calendar events");

  const events = await getUpcomingEvents();
  if (events.length === 0) {
    log("warn", "No events found in Google Calendar response", {
      calendarIds,
      calendarEnvSource,
      runtimeTimeZone: getRuntimeTimeZone(),
    });
    return;
  }

  log("info", "Fetched Google Calendar events", {
    eventCount: events.length,
    events: events.map(serializeEventForLog),
  });

  // Group events by day
  const eventsByDay = {};
  events.forEach((event) => {
    const eventStartDate = getEventStartDate(event);
    const eventDate = eventStartDate
      ? eventStartDate.toLocaleDateString()
      : new Date().toLocaleDateString();

    if (!eventsByDay[eventDate]) {
      eventsByDay[eventDate] = [];
    }
    eventsByDay[eventDate].push(event);
  });

  let message = "";
  let hasDateEvent = false;
  const sortedDates = Object.keys(eventsByDay).sort(
    (a, b) => new Date(a) - new Date(b)
  );

  for (const [index, date] of sortedDates.entries()) {
    if (index > 0) {
      message += `\n---\n`; // Separator between days
    }

    message += `📅 *${formatDate(date)}*\n\n`;

    for (const event of eventsByDay[date]) {
      const eventTime = event.start?.dateTime
        ? new Date(event.start.dateTime).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "All day";

      let summary = event.summary;
      let description = event.description;
      let location = event.location;
      let details;

      if (!summary || !description || !location) {
        details = await getEventDetails(event.sourceCalendarId, event.id);
        summary = summary || details?.summary || "Untitled";
        description = description || details?.description;
        location = location || details?.location;
      }

      const summaryLink = event.htmlLink
        ? `[${summary}](${event.htmlLink})`
        : summary;

      message += `🕒 *${eventTime}* - ${summaryLink}`;

      if (
        eventContainsDateKeywords({
          summary,
          description,
          location,
        })
      ) {
        hasDateEvent = true;
      }

      if (calendarIds.length > 1) {
        message += `\n🗂 ${event.organizer?.displayName}`;
      }

      if (event.description) {
        message += `\n📄 ${event.description}`;
      }

      if (event.location) {
        message += `\n📍 ${event.location}`;
      }

      message += `\n`; // Ensures spacing after each event
    }
  }

  await sendWebhookMessage(message);

  if (hasDateEvent) {
    await delay(15000);
    await sendWebhookMessage(
      "Need an additional initiative plan for the date. Be prepared."
    );
  }
}

function formatJobFailureMessage(error) {
  const serialized = serializeError(error);
  const failedCalendars = serialized.calendarFailures
    ?.map((failure) => `- ${failure.calendarId}: ${failure.error.message}`)
    .join("\n");

  return [
    "Cronos не смог получить события Google Calendar.",
    `Ошибка: ${serialized.message}`,
    failedCalendars ? `Календари:\n${failedCalendars}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function runJobAndReportErrors() {
  try {
    await runJob();
  } catch (error) {
    logError("Calendar job failed", error);
    await sendWebhookMessage(formatJobFailureMessage(error));
  }
}

function logStartupConfig() {
  log("info", "Cronus config", {
    calendarIds,
    calendarEnvSource,
    runtimeTimeZone: getRuntimeTimeZone(),
    notificationWebhookHost: getUrlHost(notificationWebhookUrl),
    notificationWebhookSource: process.env.NOTIFICATION_WEBHOOK_URL
      ? "NOTIFICATION_WEBHOOK_URL"
      : "default",
    quotaProjectId: quotaProjectId || null,
  });

  if (calendarEnvSource === "default") {
    log("warn", "CALENDAR_IDS/CALENDAR_ID is not configured", {
      fallback: "primary",
      note:
        "Service accounts usually need an explicitly shared calendar ID. Set CALENDAR_IDS or CALENDAR_ID if no events appear.",
    });
  }
}

function startScheduler() {
  logStartupConfig();

  // Schedule cron job to run daily at 08:00
  cron.schedule("0 8 * * *", runJobAndReportErrors);
  cron.schedule("0 18 * * 2,4", function () {
    sendWebhookMessage("Время оплатить Калиграфию");
  });
  cron.schedule("0 15 * * 3", function () {
    sendWebhookMessage("Время оплатить Репетитора по математике");
  });

  runJobAndReportErrors(); // Run immediately when the script starts
  log("info", "Cronus started");
}

if (require.main === module) {
  startScheduler();
}

module.exports = {
  fetchEventsForCalendar,
  formatJobFailureMessage,
  getEventsInRange,
  runJob,
  runJobAndReportErrors,
  serializeError,
  startScheduler,
};
