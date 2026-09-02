import { Router } from "express";
import mongoose from "mongoose";
import { resolveItem } from "../catalog.js";
import { HttpError } from "../errors.js";
import { DEFAULT_USER_ID, MEAL_TYPES, Meal, type MealType } from "../models/Meal.js";

const mealsRouter = Router();

function userIdFrom(req: { query: Record<string, unknown> }): string {
  return typeof req.query.userId === "string" && req.query.userId.trim()
    ? req.query.userId.trim()
    : DEFAULT_USER_ID;
}

/** Local midnight–end for an eatenAt. Same meal next calendar day is not a duplicate. */
function dayRange(at: Date): { start: Date; end: Date } {
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  const end = new Date(at);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function mealId(id: string): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, "Invalid meal id");
  }
  return new mongoose.Types.ObjectId(id);
}

function parseMealType(value: unknown): MealType {
  if (typeof value !== "string" || !MEAL_TYPES.includes(value as MealType)) {
    throw new HttpError(400, `mealType must be one of: ${MEAL_TYPES.join(", ")}`);
  }
  return value as MealType;
}

/** Attach grams + macros from foods.json. Request bodies must not send calories. */
function parseItems(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "items must be a non-empty array");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new HttpError(400, `items[${index}] is invalid`);
    }
    const row = item as { foodId?: unknown; quantity?: unknown; unit?: unknown };
    if (typeof row.foodId !== "string" || typeof row.unit !== "string") {
      throw new HttpError(400, `items[${index}] needs foodId and unit`);
    }
    return resolveItem({
      foodId: row.foodId,
      quantity: Number(row.quantity),
      unit: row.unit,
    });
  });
}

mealsRouter.get("/", async (req, res, next) => {
  try {
    const filter: Record<string, unknown> = { userId: userIdFrom(req) };
    const range: { $gte?: Date; $lte?: Date } = {};
    // Optional ISO window so the agent can ask for "this morning".
    if (typeof req.query.from === "string") range.$gte = new Date(req.query.from);
    if (typeof req.query.to === "string") range.$lte = new Date(req.query.to);
    if (range.$gte || range.$lte) filter.eatenAt = range;

    const meals = await Meal.find(filter).sort({ eatenAt: -1 }).lean();
    res.json({ meals });
  } catch (error) {
    next(error);
  }
});

mealsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const userId = userIdFrom(req);
    const mealType = parseMealType(body.mealType);
    const items = parseItems(body.items);
    const eatenAt = body.eatenAt ? new Date(body.eatenAt) : new Date();
    const { start, end } = dayRange(eatenAt);

    const sameDayMeals = await Meal.find({
      userId,
      mealType,
      eatenAt: { $gte: start, $lte: end },
    }).sort({ eatenAt: -1 });

    const duplicate = items.filter((incoming) =>
      sameDayMeals.some((meal) =>
        meal.items.some(
          (existing) =>
            existing.foodId === incoming.foodId &&
            existing.unit === incoming.unit &&
            Number(existing.quantity) === incoming.quantity,
        ),
      ),
    );
    if (sameDayMeals.length > 0 && duplicate.length === items.length) {
      const names = duplicate
        .map((row) => `${row.quantity} ${row.foodName}`)
        .join(" and ");
      res.json({
        meal: sameDayMeals[0],
        unchanged: true,
        alreadyPresent: true,
        message: `${names} already logged for ${mealType} that day. Nothing was added.`,
      });
      return;
    }

    const meal = await Meal.create({
      userId,
      mealType,
      eatenAt,
      items,
    });
    res.status(201).json({ meal, unchanged: false });
  } catch (error) {
    next(error);
  }
});

mealsRouter.patch("/:mealId/items/:itemId", async (req, res, next) => {
  try {
    const meal = await Meal.findOne({
      _id: mealId(req.params.mealId),
      userId: userIdFrom(req),
    });
    if (!meal) throw new HttpError(404, "Meal not found");

    const item = meal.items.find((row) => row.itemId === req.params.itemId);
    if (!item) throw new HttpError(404, "Item not found");

    const body = req.body ?? {};
    const foodId = typeof body.foodId === "string" ? body.foodId : item.foodId;
    const unit = typeof body.unit === "string" ? body.unit : item.unit;
    const quantity = body.quantity !== undefined ? Number(body.quantity) : item.quantity;

    const resolved = resolveItem({ foodId, unit, quantity });
    const alreadySame =
      item.foodId === resolved.foodId &&
      item.unit === resolved.unit &&
      Number(item.quantity) === resolved.quantity;

    // "Make it 3 rotis" when it is already 3 — do not write, tell the agent to say so.
    if (alreadySame) {
      res.json({
        meal,
        unchanged: true,
        message: `${resolved.quantity} ${resolved.foodName} is already logged that way. Nothing was changed.`,
      });
      return;
    }

    item.foodId = resolved.foodId;
    item.foodName = resolved.foodName;
    item.unit = resolved.unit;
    item.quantity = resolved.quantity;
    item.grams = resolved.grams;
    item.macros = resolved.macros;

    await meal.save();
    res.json({ meal, unchanged: false });
  } catch (error) {
    next(error);
  }
});

mealsRouter.delete("/:mealId/items/:itemId", async (req, res, next) => {
  try {
    const meal = await Meal.findOne({
      _id: mealId(req.params.mealId),
      userId: userIdFrom(req),
    });
    if (!meal) throw new HttpError(404, "Meal not found");

    const nextItems = meal.items.filter((row) => row.itemId !== req.params.itemId);
    if (nextItems.length === meal.items.length) {
      throw new HttpError(404, "Item not found");
    }

    if (nextItems.length === 0) {
      // Schema forbids empty items[]; drop the meal so the page has no blank card.
      await meal.deleteOne();
      res.json({ meal: null, deletedMeal: true });
      return;
    }

    meal.items = nextItems as typeof meal.items;
    await meal.save();
    res.json({ meal, deletedMeal: false });
  } catch (error) {
    next(error);
  }
});

mealsRouter.delete("/:mealId", async (req, res, next) => {
  try {
    const result = await Meal.findOneAndDelete({
      _id: mealId(req.params.mealId),
      userId: userIdFrom(req),
    });
    if (!result) throw new HttpError(404, "Meal not found");
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default mealsRouter;
