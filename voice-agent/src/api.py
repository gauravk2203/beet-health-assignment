"""HTTP client for the Express meal API. The agent never talks to Mongo directly."""

import os
from typing import Any

import httpx

BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:3001").rstrip("/")
_client = httpx.AsyncClient(base_url=BASE_URL, timeout=15.0)


async def _request(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    response = await _client.request(method, path, **kwargs)
    try:
        payload = response.json()
    except ValueError:
        payload = {"error": response.text or "Invalid response from meal API"}

    # 4xx/5xx become {ok: false} so the LLM can speak the error instead of crashing the turn.
    if response.is_error:
        message = payload.get("error") if isinstance(payload, dict) else None
        return {
            "ok": False,
            "error": message or f"Meal API error {response.status_code}",
            "status": response.status_code,
        }

    if isinstance(payload, dict):
        return {"ok": True, **payload}
    return {"ok": True, "data": payload}


async def search_foods(query: str) -> dict[str, Any]:
    return await _request("GET", "/api/foods", params={"q": query})


async def list_meals(
    from_iso: str | None = None, to_iso: str | None = None
) -> dict[str, Any]:
    params: dict[str, str] = {}
    if from_iso:
        params["from"] = from_iso
    if to_iso:
        params["to"] = to_iso
    return await _request("GET", "/api/meals", params=params)


async def log_meal(
    meal_type: str,
    items: list[dict[str, Any]],
    eaten_at: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"mealType": meal_type, "items": items}
    if eaten_at:
        body["eatenAt"] = eaten_at
    return await _request("POST", "/api/meals", json=body)


async def update_item(
    meal_id: str,
    item_id: str,
    quantity: float | None = None,
    unit: str | None = None,
    food_id: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {}
    if quantity is not None:
        body["quantity"] = quantity
    if unit is not None:
        body["unit"] = unit
    if food_id is not None:
        body["foodId"] = food_id
    return await _request("PATCH", f"/api/meals/{meal_id}/items/{item_id}", json=body)


async def delete_item(meal_id: str, item_id: str) -> dict[str, Any]:
    return await _request("DELETE", f"/api/meals/{meal_id}/items/{item_id}")
