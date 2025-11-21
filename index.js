const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const TOKEN = "8496137521:AAEwyr8ZG42STcYkUKqzW70MRgJmVHUsnxg"; 
const TELEGRAM_URL = `https://api.telegram.org/bot${TOKEN}`;

const app = express();
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Bot Running OK!");
});

// เมื่อ Telegram ส่งข้อความเข้ามา
app.post(`/webhook`, async (req, res) => {
  const message = req.body.message;

  if (message) {
    const chatId = message.chat.id;
    const text = message.text;

    await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: chatId,
      text: "บอทตอบกลับ: " + text,
    });
  }

  return res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
});
