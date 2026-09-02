import { Router } from "express";
import { listFoods, searchFoods } from "../catalog.js";

const foodsRouter = Router();

foodsRouter.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const foods = q.trim() ? searchFoods(q) : listFoods();
  res.json({ foods });
});

export default foodsRouter;
