export type Macros = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type MealItem = {
  itemId: string;
  foodId: string;
  foodName: string;
  quantity: number;
  unit: string;
  grams: number;
  /** Copied from the catalog at save time — do not recompute in the UI. */
  macros: Macros;
};

export type Meal = {
  _id: string;
  userId: string;
  mealType: MealType;
  eatenAt: string;
  items: MealItem[];
  totals: Macros;
};
