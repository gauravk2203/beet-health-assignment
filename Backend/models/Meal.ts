import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";
import { addMacros, emptyMacros, type Macros } from "./Food.js";

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const DEFAULT_USER_ID = "demo";

const macrosSchema = new Schema<Macros>(
  {
    calories: { type: Number, required: true, min: 0 },
    protein: { type: Number, required: true, min: 0 },
    carbs: { type: Number, required: true, min: 0 },
    fat: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const mealItemSchema = new Schema(
  {
    itemId: { type: String, required: true, default: () => randomUUID() },
    foodId: { type: String, required: true },
    foodName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.01 },
    unit: { type: String, required: true },
    grams: { type: Number, required: true, min: 0 },
    macros: { type: macrosSchema, required: true },
  },
  { _id: false },
);

const mealSchema = new Schema(
  {
    userId: { type: String, required: true, default: DEFAULT_USER_ID, index: true },
    mealType: { type: String, required: true, enum: MEAL_TYPES },
    eatenAt: { type: Date, required: true, default: () => new Date() },
    items: {
      type: [mealItemSchema],
      required: true,
      validate: {
        validator: (items: unknown[]) => Array.isArray(items) && items.length > 0,
        message: "A meal must have at least one item",
      },
    },
    totals: { type: macrosSchema, required: true, default: emptyMacros },
  },
  { timestamps: true },
);

mealSchema.index({ userId: 1, eatenAt: -1 });
mealSchema.index({ "items.itemId": 1 });
mealSchema.index({ "items.foodId": 1 });

mealSchema.pre("validate", function setTotals() {
  this.totals = (this.items ?? []).reduce(
    (sum, item) => addMacros(sum, item.macros ?? emptyMacros()),
    emptyMacros(),
  );
});

export type MealItem = {
  itemId: string;
  foodId: string;
  foodName: string;
  quantity: number;
  unit: string;
  grams: number;
  macros: Macros;
};

export type MealDoc = {
  userId: string;
  mealType: MealType;
  eatenAt: Date;
  items: MealItem[];
  totals: Macros;
  createdAt: Date;
  updatedAt: Date;
};

export const Meal = mongoose.model("Meal", mealSchema);
