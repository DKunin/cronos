const { google } = require("googleapis");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");
const dotenv = require("dotenv");
const fs = require("fs");

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
    await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    console.log("Telegram notification sent!");
  } catch (error) {
    console.error("Error sending Telegram message:", error);
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

    message += `📅 *${date}*\n\n`;

    eventsByDay[date].forEach((event) => {
      const eventTime = event.start?.dateTime
        ? new Date(event.start.dateTime).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "All day";

      message += `🕒 *${eventTime}* - ${event.summary}`;

      if (event.description) {
        message += `\n📄 ${event.description}`;
      }

      if (event.location) {
        message += `\n📍 ${event.location}`;
      }

      if (event.htmlLink) {
        message += `\n🔗 [View Event](${event.htmlLink})`;
      }

      message += `\n\n`; // Ensures spacing after each event
    });
  });

  await sendTelegramMessage(message);
}

// Schedule cron job to run daily at 12:00 PM
cron.schedule("0 8 * * *", runJob);
runJob(); // Run immediately when the script starts
console.log("Cron job scheduled to run daily at 08:00 PM.");
