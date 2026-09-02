import { Router } from "express";
import { listFoods, searchFoods } from "../catalog.js";

const foodsRouter = Router();

foodsRouter.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  // Agent must search before log; empty q returns the full 30-dish catalog.
  const foods = q.trim() ? searchFoods(q) : listFoods();
  res.json({ foods });
});

export default foodsRouter;
