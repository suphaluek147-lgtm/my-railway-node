const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_URL = `https://api.telegram.org/bot${TOKEN}`;

const app = express();
app.use(bodyParser.json());

// เช็คว่าเว็บรันอยู่
app.get("/", (req, res) => {
  res.send("Bot Running OK");
});

// รับ webhook จาก Telegram
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.message;
    if (message) {
      const chatId = message.chat.id;
      const text = message.text || "";

      // ส่งข้อความกลับ
      await axios.post(`${TELEGRAM_URL}/sendMessage`, {
        chat_id: chatId,
        text: `คุณพิมพ์ว่า: ${text}`,
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("webhook error:", err);
    res.sendStatus(500);
  }
});

// Port Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
