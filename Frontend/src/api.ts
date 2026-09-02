import type { Meal } from "./types";

export async function getMeals(): Promise<Meal[]> {
  const response = await fetch("/api/meals");
  if (!response.ok) {
    throw new Error("Could not load meals");
  }
  const body = (await response.json()) as { meals: Meal[] };
  return body.meals ?? [];
}
