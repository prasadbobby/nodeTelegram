const path = require("path");
const express = require("express");
const hbs = require("hbs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const morgan = require("morgan");
const { body, validationResult } = require("express-validator");
const admin = require("firebase-admin");
const { Telegraf } = require("telegraf");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Enhanced security
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Compression
app.use(compression());

// Logging
app.use(morgan("combined"));

const staticPath = path.join(__dirname, "./public");
const templatePath = path.join(__dirname, "./templates/views");

app.use(express.static(staticPath));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.set("view engine", "hbs");
app.set("views", templatePath);

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Firebase initialization
const serviceAccount = require("./software.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

// Telegraf bot initialization
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Routes
app.get("/", (req, res) => {
  res.send("Welcome to the advanced server!");
});

app.get("/form", (req, res) => {
  res.render("form");
});

app.post("/form", [
  body("id").notEmpty().trim(),
  body("name").notEmpty().trim(),
  body("email").isEmail().normalizeEmail(),
  body("mobile").isMobilePhone(),
  body("checkbox1").isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    await insertUserData(req.body);
    await notifyAdminViaBot(req.body);
    res.status(201).json({ message: "User data successfully inserted" });
  } catch (error) {
    console.error("Error processing form:", error);
    res.status(500).json({ message: "An error occurred while processing your request" });
  }
});

// Helper functions
async function insertUserData(userData) {
  try {
    const writeResult = await admin
      .firestore()
      .collection("userdata")
      .doc(userData.id)
      .set(userData);
    console.log("Document successfully written!", writeResult);
    return writeResult;
  } catch (error) {
    console.error("Error writing document: ", error);
    throw error;
  }
}

async function notifyAdminViaBot(userData) {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  const message = `
New user registered:
ID: ${userData.id}
Name: ${userData.name}
Email: ${userData.email}
Mobile: ${userData.mobile}
Checkbox1: ${userData.checkbox1}
  `;
  
  try {
    await bot.telegram.sendMessage(adminChatId, message);
    console.log("Admin notified via Telegram");
  } catch (error) {
    console.error("Error sending Telegram message:", error);
  }
}

// Telegram bot commands
bot.command("stats", async (ctx) => {
  try {
    const snapshot = await admin.firestore().collection("userdata").get();
    const userCount = snapshot.size;
    ctx.reply(`Total registered users: ${userCount}`);
  } catch (error) {
    console.error("Error fetching stats:", error);
    ctx.reply("An error occurred while fetching stats.");
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// Start the server
const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    bot.stop("SIGTERM");
  });
});

// Launch the Telegram bot
bot.launch();

// Enable graceful stop for the bot
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

module.exports = app;
