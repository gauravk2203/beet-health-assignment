/** Matches Beet foods.json: macros per 100g, units as gram weights. */

export const MACRO_KEYS = ["calories", "protein", "carbs", "fat"] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

export type Macros = Record<MacroKey, number>;

export type FoodUnit = {
  name: string;
  grams: number;
};

export type Food = {
  id: string;
  name: string;
  aliases: string[];
  macrosPer100g: Macros;
  units: FoodUnit[];
};

export function emptyMacros(): Macros {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

export function scaleMacros(per100g: Macros, grams: number): Macros {
  const factor = grams / 100;
  return {
    calories: round1(per100g.calories * factor),
    protein: round1(per100g.protein * factor),
    carbs: round1(per100g.carbs * factor),
    fat: round1(per100g.fat * factor),
  };
}

export function addMacros(a: Macros, b: Macros): Macros {
  return {
    calories: round1(a.calories + b.calories),
    protein: round1(a.protein + b.protein),
    carbs: round1(a.carbs + b.carbs),
    fat: round1(a.fat + b.fat),
  };
}

export function findUnit(food: Food, unitName: string): FoodUnit | undefined {
  const wanted = unitName.trim().toLowerCase();
  return food.units.find((unit) => unit.name.toLowerCase() === wanted);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
