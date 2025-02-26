### **📅 Google Calendar Telegram Reminder**
This Node.js script fetches upcoming events from **Google Calendar** using a **service account** and sends daily reminders via **Telegram**.

[![Deploy to Server](https://github.com/DKunin/cronos/actions/workflows/deploy.yml/badge.svg)](https://github.com/DKunin/cronos/actions/workflows/deploy.yml)

---

## **📌 Features**
✅ Fetches **events for today + 3 days ahead**  
✅ Sends a **Telegram notification** with event details  
✅ Includes **event time, description, location, and a direct link**  
✅ Runs **daily at 12:00 PM** using a cron job  

---

## **🚀 Setup & Installation**

### **1. Clone the repository**
```sh
git clone https://github.com/your-repo/calendar-reminder.git
cd calendar-reminder
```

### **2. Install dependencies**
```sh
npm install
```

### **3. Set up Google Calendar API**
- Enable **Google Calendar API** in [Google Cloud Console](https://console.cloud.google.com/)
- Create a **Service Account** and download the JSON key (`cronus.json`)
- **Share your Google Calendar** with the service account email

### **4. Create a `.env` file**
```ini
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id
CALENDAR_ID=your_calendar_id (or use "primary")
```

---

## **📜 Usage**
Run the script manually:
```sh
node index.js
```
It will also **run automatically every day at 12:00 PM**.

---

## **🔧 Customization**
- Modify `runJob()` in **`index.js`** to adjust the message format.  
- Change the cron schedule in:
  ```js
  cron.schedule("0 12 * * *", runJob);
  ```
  (Uses **cron syntax**, adjust timing as needed.)

---

## **📞 Need Help?**
Feel free to open an issue or reach out! 🚀