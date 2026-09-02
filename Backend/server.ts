import cors from "cors";
import "dotenv/config";
import express from "express";
import { connectDb } from "./db/db.js";
import { HttpError } from "./errors.js";
import foodsRouter from "./routes/foods.js";
import livekitRouter from "./routes/livekit.js";
import mealsRouter from "./routes/meals.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/foods", foodsRouter);
app.use("/api/meals", mealsRouter);
app.use("/api/livekit", livekitRouter);

// Routes throw HttpError so the agent can speak the message instead of seeing a stack trace.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof Error && err.name === "ValidationError") {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 3001;
const mongoUri = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/beet";

// Do not listen until Mongo is up — a restart must not appear to "work" with an empty in-memory store.
connectDb(mongoUri)
  .then(() => {
    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed", error);
    process.exit(1);
  });
