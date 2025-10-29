"use strict";

const { google } = require("googleapis");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");
const dotenv = require("dotenv");
const fs = require("fs");
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

dotenv.config();

// Load service account credentials
const serviceAccount = JSON.parse(fs.readFileSync("cronus.json", "utf8"));

// Google Calendar settings
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];
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
      console.warn("Failed to parse CALENDAR_IDS as JSON. Falling back to comma separation.");
    }
  }

  return trimmed.split(",").map((id) => id.trim()).filter(Boolean);
}

const calendarEnv =
  process.env.CALENDAR_IDS || process.env.CALENDAR_ID || "primary";
const parsedCalendarIds = parseCalendarIdsFromEnv(calendarEnv);
const calendarIds =
  parsedCalendarIds.length > 0
    ? Array.from(new Set(parsedCalendarIds))
    : ["primary"];

// Telegram settings
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!botToken || !chatId) {
  console.error("Missing Telegram bot token or chat ID.");
  process.exit(1);
}

// Initialize Telegram bot
const bot = new TelegramBot(botToken, { polling: false });

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
function getEventStartDate(event) {
  if (event.start?.dateTime) {
    return new Date(event.start.dateTime);
  }

  if (event.start?.date) {
    return new Date(event.start.date);
  }

  return null;
}

async function fetchEventsForCalendar(calendarId, timeMin, timeMax) {
  try {
    const authClient = await getAuthClient();
    const response = await calendar.events.list({
      auth: authClient,
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    return (response.data.items || []).map((event) => ({
      ...event,
      sourceCalendarId: calendarId,
    }));
  } catch (error) {
    console.error(
      `Error fetching events for calendar ${calendarId}:`,
      error.response ? error.response.data : error
    );
    return [];
  }
}

async function getEventsInRange(timeMin, timeMax) {
  const events = await Promise.all(
    calendarIds.map((calendarId) =>
      fetchEventsForCalendar(calendarId, timeMin, timeMax)
    )
  );

  return events
    .flat()
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
  futureDate.setDate(futureDate.getDate() + 5); // 3 days ahead
  const endOfDay = new Date(futureDate.setHours(23, 59, 59, 999)).toISOString();

  console.log(`Fetching events from ${startOfDay} to ${endOfDay}`);

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
    console.error(
      `Error fetching event details for ${eventId} on ${calendarId}:`,
      error.response ? error.response.data : error
    );
    return null;
  }
}

/**
 * Send a notification via Telegram
 */
async function sendTelegramMessage(message) {
  try {
    await bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    console.log("Telegram notification sent!");
  } catch (error) {
    console.error("Error sending Telegram message:", error);
  }
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch events and send Telegram notifications
 */
async function runJob() {
  console.log("Checking calendar events...");

  const events = await getUpcomingEvents();
  if (events.length === 0) {
    console.log("No events found.");
    return;
  }

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

  await sendTelegramMessage(message);

  if (hasDateEvent) {
    await delay(15000);
    await sendTelegramMessage(
      "Need an additional initiative plan for the date. Be prepared."
    );
  }
}

// Schedule cron job to run daily at 12:00 PM
cron.schedule("0 8 * * *", runJob);
runJob(); // Run immediately when the script starts
console.log("Cron job scheduled to run daily at 08:00 PM.");
