### **📅 Напоминания Google Calendar через Webhook**
Скрипт на Node.js получает ближайшие события из **Google Calendar** через service account и отправляет напоминания в **n8n webhook**.

[![Deploy to Server](https://github.com/DKunin/cronos/actions/workflows/deploy.yml/badge.svg)](https://github.com/DKunin/cronos/actions/workflows/deploy.yml)

---

## **📌 Возможности**
✅ Получает события **за сегодня + 3 дня вперед**  
✅ Отправляет уведомление POST-запросом в **n8n webhook**  
✅ Включает **время события, описание, место и прямую ссылку**  
✅ Собирает события из **нескольких календарей** в один отчет  
✅ Запускается **каждый день в 08:00** через cron job  

---

## **🚀 Установка и настройка**

### **1. Склонировать репозиторий**
```sh
git clone https://github.com/your-repo/calendar-reminder.git
cd calendar-reminder
```

### **2. Установить зависимости**
```sh
npm install
```

### **3. Настроить Google Calendar API**
- Включить **Google Calendar API** в [Google Cloud Console](https://console.cloud.google.com/)
- Создать **Service Account** и скачать JSON-ключ в файл `cronus.json`
- Выдать service account доступ к нужным Google Calendar

### **4. Создать `.env` файл**
```ini
# Можно не задавать: по умолчанию используется текущий n8n webhook.
NOTIFICATION_WEBHOOK_URL=https://n8n.kunini.ru/webhook/489ce88c-f9e9-43ec-a36c-e5b787f6a287

# Один calendar ID, JSON-массив или список через запятую.
CALENDAR_IDS=["calendar_one@group.calendar.google.com","calendar_two@group.calendar.google.com"]
# Или fallback на один calendar ID.
# CALENDAR_ID=primary
```

---

## **📜 Использование**
Запустить скрипт вручную:
```sh
node index.js
```
Скрипт также **автоматически запускается каждый день в 08:00**.

---

## **Настройка**
- Чтобы изменить формат сообщения, обновить `runJob()` в **`index.js`**.
- Чтобы использовать несколько календарей, задать `CALENDAR_IDS` в `.env` как JSON-массив или список через запятую.
- Чтобы изменить адрес webhook, задать `NOTIFICATION_WEBHOOK_URL`.
- Deploy workflow в GitHub Actions тоже отправляет уведомление в этот webhook после успешного деплоя.
- Чтобы изменить расписание, обновить cron expression:
  ```js
  cron.schedule("0 8 * * *", runJob);
  ```
  Используется **cron syntax**.

## **Диагностика**
- При старте скрипт пишет активные `calendarIds`, источник настройки (`CALENDAR_IDS`, `CALENDAR_ID` или fallback `primary`) и runtime timezone.
- Каждый запрос `Google Calendar events.list` логируется с `calendarId`, `timeMin`, `timeMax`, `timeZone`, `maxResults` и числом найденных событий.
- После загрузки всех календарей логируется общий список полученных событий.
- Для каждого события в логах видны `id`, `summary`, `start`, `end`, `sourceCalendarId`, `location`, `organizer` и `htmlLink`.
- Ошибки Google API больше не превращаются в пустой список событий: в лог пишутся HTTP status, message и детали `googleError`.
- Если упали все календари, задача отправляет webhook-уведомление с причиной ошибки.
- Если `CALENDAR_IDS` и `CALENDAR_ID` не заданы, будет предупреждение про fallback на `primary`; для service account обычно нужно явно расшарить календарь и указать его ID.
