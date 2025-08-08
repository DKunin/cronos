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

const ALERT_STATE_FILE = "alert_state.json";

function hasAlertBeenSentToday() {
  if (!fs.existsSync(ALERT_STATE_FILE)) {
    return false;
  }
  try {
    const state = JSON.parse(fs.readFileSync(ALERT_STATE_FILE, "utf8"));
    const today = moment().format("YYYY-MM-DD");
    return state.lastAlertDate === today;
  } catch (error) {
    console.error("Error reading alert state:", error);
    return false; // Assume not sent if state is corrupted
  }
}

function recordAlertSentToday() {
  const today = moment().format("YYYY-MM-DD");
  const state = { lastAlertDate: today };
  try {
    fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify(state));
    console.log("Recorded alert sent for today.");
  } catch (error) {
    console.error("Error writing alert state:", error);
  }
}

dotenv.config();

// Load service account credentials
const serviceAccount = JSON.parse(fs.readFileSync("cronus.json", "utf8"));

// Google Calendar settings
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];
const calendarId = process.env.CALENDAR_ID || "primary";

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
const auth = new google.auth.JWT(
  serviceAccount.client_email,
  null,
  serviceAccount.private_key,
  SCOPES
);
const calendar = google.calendar({ version: "v3", auth });

/**
 * Fetch today's events from Google Calendar
 */
async function getTodayEvents() {
  const now = new Date();
  const startOfDay = new Date(now.setHours(0, 0, 0, 0)).toISOString();
  const endOfDay = new Date(now.setHours(23, 59, 59, 999)).toISOString();

  try {
    const response = await calendar.events.list({
      calendarId,
      timeMin: startOfDay,
      timeMax: endOfDay,
      singleEvents: true,
      orderBy: "startTime",
    });

    return response.data.items || [];
  } catch (error) {
    console.error(
      "Error fetching events:",
      error.response ? error.response.data : error
    );
    return [];
  }
}

async function getUpcomingEvents() {
  const now = new Date();
  const startOfDay = new Date(now.setHours(0, 0, 0, 0)).toISOString();

  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 5); // 3 days ahead
  const endOfDay = new Date(futureDate.setHours(23, 59, 59, 999)).toISOString();

  console.log(`Fetching events from ${startOfDay} to ${endOfDay}`);

  try {
    const response = await calendar.events.list({
      calendarId,
      timeMin: startOfDay,
      timeMax: endOfDay,
      singleEvents: true,
      orderBy: "startTime",
    });

    return response.data.items || [];
  } catch (error) {
    console.error(
      "Error fetching events:",
      error.response ? error.response.data : error
    );
    return [];
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

/**
 * Checks the total online time for the day and sends an alert if it exceeds 5 hours.
 */
async function checkDailyOnlineStatus() {
  console.log("Checking daily online status...");

  if (hasAlertBeenSentToday()) {
    console.log("Alert for >5 hours online time has already been sent today.");
    return;
  }

  const events = await getTodayEvents();
  if (events.length === 0) {
    console.log("No events found for today.");
    return;
  }

  let totalDuration = 0;
  const onlineEvents = events.filter(
    (event) =>
      event.summary &&
      event.summary.toLowerCase().includes("online") &&
      event.start.dateTime &&
      event.end.dateTime
  );

  onlineEvents.forEach((event) => {
    const startTime = moment(event.start.dateTime);
    const endTime = moment(event.end.dateTime);
    totalDuration += moment.duration(endTime.diff(startTime)).asMilliseconds();
  });

  const hours = totalDuration / (1000 * 60 * 60);
  console.log(`Total online time today: ${hours.toFixed(2)} hours.`);

  if (hours > 5) {
    const message = `🚨 *Alert:* Daily online time has exceeded 5 hours. Total today: ${hours.toFixed(
      2
    )} hours.`;
    await sendTelegramMessage(message);
    recordAlertSentToday();
  }
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
    const eventDate = event.start?.dateTime
      ? new Date(event.start.dateTime).toLocaleDateString()
      : new Date(event.start.date).toLocaleDateString();

    if (!eventsByDay[eventDate]) {
      eventsByDay[eventDate] = [];
    }
    eventsByDay[eventDate].push(event);
  });

  let message = "";
  const sortedDates = Object.keys(eventsByDay).sort(
    (a, b) => new Date(a) - new Date(b)
  );

  sortedDates.forEach((date, index) => {
    if (index > 0) {
      message += `\n---\n`; // Separator between days
    }

    message += `📅 *${formatDate(date)}*\n\n`;

    eventsByDay[date].forEach((event) => {
      const eventTime = event.start?.dateTime
        ? new Date(event.start.dateTime).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "All day";

      message += `🕒 *${eventTime}* - [${event.summary}](${event.htmlLink})`;

      if (event.description) {
        message += `\n📄 ${event.description}`;
      }

      if (event.location) {
        message += `\n📍 ${event.location}`;
      }

      message += `\n`; // Ensures spacing after each event
    });
  });

  await sendTelegramMessage(message);
}

// Schedule cron job to run daily at 8:00 AM
cron.schedule("0 8 * * *", runJob);
console.log("Cron job for upcoming events scheduled to run daily at 08:00 AM.");

// Schedule cron job for online status check to run hourly
cron.schedule("0 * * * *", checkDailyOnlineStatus);
console.log("Cron job for daily online status scheduled to run hourly.");

// Initial runs
runJob();
checkDailyOnlineStatus();
