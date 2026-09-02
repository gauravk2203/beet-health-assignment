import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HttpError } from "./errors.js";
import { findUnit, scaleMacros, type Food, type Macros } from "./models/Food.js";

// Loaded once at boot. foods.json is the source of truth — not a Mongo collection.
const catalogPath = join(process.cwd(), "data", "foods.json");

type CatalogFile = {
  foods: Food[];
};

const parsed = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile;
if (!Array.isArray(parsed.foods)) {
  throw new Error("foods.json must have a top-level foods array");
}

const foods: Food[] = parsed.foods;
const byId = new Map(foods.map((food) => [food.id, food]));

// Strip a trailing "s" so spoken "rotis" still hits id "roti".
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/s\b/g, "");
}

export function listFoods(): Food[] {
  return foods;
}

export function getFood(foodId: string): Food {
  const food = byId.get(foodId);
  if (!food) {
    throw new HttpError(400, `Unknown food: ${foodId}`);
  }
  return food;
}

export function searchFoods(query: string): Food[] {
  const needle = normalize(query);
  if (!needle) return foods;
  return foods.filter((food) => {
    const haystack = [food.id, food.name, ...food.aliases].map(normalize);
    return haystack.some((value) => value.includes(needle) || needle.includes(value));
  });
}

/** Validate catalog + unit, then compute grams and macros. Never trust client calories. */
export function resolveItem(input: {
  foodId: string;
  quantity: number;
  unit: string;
}): {
  foodId: string;
  foodName: string;
  quantity: number;
  unit: string;
  grams: number;
  macros: Macros;
} {
  const { foodId, unit } = input;
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new HttpError(400, "quantity must be a number greater than 0");
  }

  const food = getFood(foodId);
  const unitDef = findUnit(food, unit);
  if (!unitDef) {
    const allowed = food.units.map((entry) => entry.name).join(", ");
    throw new HttpError(400, `Unit "${unit}" is not allowed for ${food.name}. Use: ${allowed}`);
  }

  const grams = round1(quantity * unitDef.grams);
  return {
    foodId: food.id,
    foodName: food.name,
    quantity,
    unit: unitDef.name,
    grams,
    macros: scaleMacros(food.macrosPer100g, grams),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
