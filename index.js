const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const TOKEN = "8496137521:AAHxDRwhqfm7akbssSN9tBx4KDuVWhFXXXc"; // แทนที่ด้วย token จริง
const TELEGRAM_URL = `https://api.telegram.org/bot${TOKEN}`;

const app = express();
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Bot Running OK!");
});

// รับข้อความจาก Telegram (webhook)
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.message;
    if (message) {
      const chatId = message.chat.id;
      const text = message.text || "No text";
      await axios.post(`${TELEGRAM_URL}/sendMessage`, {
        chat_id: chatId,
        text: `คุณพิมพ์ว่า: ${text}`
      });
    }
    // ตอบ 200 ให้ Telegram ว่ารับแล้ว
    res.sendStatus(200);
  } catch (err) {
    console.error("webhook error:", err.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});
