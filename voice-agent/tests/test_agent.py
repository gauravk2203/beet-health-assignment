import json
import textwrap
from typing import Any

import pytest
from livekit.agents import AgentSession, inference, llm, mock_tools

from agent import Assistant


def _judge_llm() -> llm.LLM:
    return inference.LLM(model="openai/gpt-4.1-mini")


ROTI = {
    "id": "roti",
    "name": "Roti",
    "aliases": ["chapati"],
    "units": [{"name": "piece", "grams": 40}, {"name": "gram", "grams": 1}],
}
DAL = {
    "id": "dal_tadka",
    "name": "Dal Tadka",
    "aliases": ["dal"],
    "units": [{"name": "katori", "grams": 150}],
}
CHAI = {
    "id": "chai",
    "name": "Chai (with sugar)",
    "aliases": ["tea"],
    "units": [{"name": "cup", "grams": 150}],
}

LUNCH = {
    "_id": "meal-lunch",
    "mealType": "lunch",
    "items": [
        {
            "itemId": "item-roti",
            "foodId": "roti",
            "foodName": "Roti",
            "quantity": 2,
            "unit": "piece",
            "macros": {"calories": 237.6, "protein": 9.0, "carbs": 46.4, "fat": 3.0},
        },
        {
            "itemId": "item-dal",
            "foodId": "dal_tadka",
            "foodName": "Dal Tadka",
            "quantity": 1,
            "unit": "katori",
            "macros": {"calories": 180.0, "protein": 9.0, "carbs": 21.0, "fat": 6.8},
        },
    ],
}


def _search(context: Any, query: str) -> dict[str, Any]:
    needle = query.lower()
    foods: list[dict[str, Any]] = []
    if "roti" in needle or "chapati" in needle:
        foods.append(ROTI)
    if "dal" in needle:
        foods.append(DAL)
    if "chai" in needle or "tea" in needle:
        foods.append(CHAI)
    return {"ok": True, "foods": foods}


def _list_meals(
    context: Any,
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict[str, Any]:
    return {"ok": True, "meals": [LUNCH]}


def _log_meal(
    context: Any,
    meal_type: str,
    items: list[dict[str, Any]],
    eaten_at: str | None = None,
) -> dict[str, Any]:
    return {"ok": True, "meal": LUNCH}


def _update_item(
    context: Any,
    meal_id: str,
    item_id: str,
    quantity: float | None = None,
    unit: str | None = None,
    food_id: str | None = None,
) -> dict[str, Any]:
    meal = {
        **LUNCH,
        "items": [
            {
                **LUNCH["items"][0],
                "quantity": 3,
                "macros": {
                    "calories": 356.4,
                    "protein": 13.4,
                    "carbs": 69.6,
                    "fat": 4.4,
                },
            },
            LUNCH["items"][1],
        ],
    }
    return {"ok": True, "meal": meal}


def _delete_item(context: Any, meal_id: str, item_id: str) -> dict[str, Any]:
    return {"ok": True, "meal": None, "deletedMeal": True}


@pytest.mark.asyncio
async def test_logs_roti_and_dal_for_lunch() -> None:
    async with (
        _judge_llm() as judge_llm,
        AgentSession(llm=inference.LLM(model="google/gemma-4-31b-it")) as session,
    ):
        await session.start(Assistant())
        with mock_tools(
            Assistant,
            {
                "search_foods": _search,
                "log_meal": _log_meal,
                "list_meals": _list_meals,
            },
        ):
            result = await session.run(
                user_input="I had two rotis and a katori of dal for lunch."
            )

        result.expect.contains_function_call(name="search_foods")
        result.expect.contains_function_call(
            name="log_meal",
            arguments={"meal_type": "lunch"},
        )
        raw_args = (
            result.expect.contains_function_call(name="log_meal").event().item.arguments
        )
        log_args = raw_args if isinstance(raw_args, str) else json.dumps(raw_args)
        assert "roti" in log_args
        assert "dal_tadka" in log_args

        await result.expect.contains_message(role="assistant").judge(
            judge_llm,
            intent=textwrap.dedent(
                """\
                    Confirms that lunch was logged with roti and dal.
                    May mention amounts or calories from the tool. Does not invent a food.
                    """
            ),
        )


@pytest.mark.asyncio
async def test_edits_roti_quantity() -> None:
    async with (
        _judge_llm() as judge_llm,
        AgentSession(llm=inference.LLM(model="google/gemma-4-31b-it")) as session,
    ):
        await session.start(Assistant())
        with mock_tools(
            Assistant,
            {
                "search_foods": _search,
                "list_meals": _list_meals,
                "log_meal": _log_meal,
                "update_item": _update_item,
            },
        ):
            await session.run(
                user_input="I had two rotis and a katori of dal for lunch."
            )
            result = await session.run(user_input="Actually make that three rotis.")

        result.expect.contains_function_call(
            name="update_item",
            arguments={"item_id": "item-roti", "quantity": 3},
        )
        log_calls = [
            event.item.name
            for event in result.events
            if getattr(event.item, "name", None) == "log_meal"
        ]
        assert log_calls == []

        await result.expect.contains_message(role="assistant").judge(
            judge_llm,
            intent="Confirms the roti amount was changed to three. Does not claim a new meal was logged.",
        )


@pytest.mark.asyncio
async def test_deletes_chai() -> None:
    chai_meal = {
        "_id": "meal-chai",
        "mealType": "breakfast",
        "items": [
            {
                "itemId": "item-chai",
                "foodId": "chai",
                "foodName": "Chai (with sugar)",
                "quantity": 1,
                "unit": "cup",
                "macros": {
                    "calories": 105.0,
                    "protein": 2.6,
                    "carbs": 12.0,
                    "fat": 4.5,
                },
            }
        ],
    }

    def list_chai(
        context: Any,
        from_iso: str | None = None,
        to_iso: str | None = None,
    ) -> dict[str, Any]:
        return {"ok": True, "meals": [chai_meal]}

    async with (
        _judge_llm() as judge_llm,
        AgentSession(llm=inference.LLM(model="google/gemma-4-31b-it")) as session,
    ):
        await session.start(Assistant())
        with mock_tools(
            Assistant,
            {
                "list_meals": list_chai,
                "delete_item": _delete_item,
            },
        ):
            result = await session.run(
                user_input="Remove the chai I logged this morning."
            )

        result.expect.contains_function_call(
            name="delete_item",
            arguments={"item_id": "item-chai"},
        )
        await result.expect.contains_message(role="assistant").judge(
            judge_llm,
            intent="Confirms the chai was removed. Does not log a new food.",
        )


@pytest.mark.asyncio
async def test_rejects_food_outside_catalog() -> None:
    async with (
        _judge_llm() as judge_llm,
        AgentSession(llm=inference.LLM(model="google/gemma-4-31b-it")) as session,
    ):
        await session.start(Assistant())
        with mock_tools(Assistant, {"search_foods": _search, "log_meal": _log_meal}):
            result = await session.run(user_input="I had a burger for lunch.")

        result.expect.contains_function_call(name="search_foods")
        calls = [
            event.item.name
            for event in result.events
            if getattr(event.item, "name", None) == "log_meal"
        ]
        assert calls == []
        await result.expect.contains_message(role="assistant").judge(
            judge_llm,
            intent="Does not log the burger. Says it is not in the food list or cannot be logged.",
        )
