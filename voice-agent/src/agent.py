import logging
import textwrap
from typing import Any

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    RunContext,
    TurnHandlingOptions,
    cli,
    function_tool,
    inference,
    room_io,
)
from livekit.plugins import ai_coustics

import api

logger = logging.getLogger("agent")

load_dotenv(".env.local")

INSTRUCTIONS = textwrap.dedent(
    """\
    You are a meal logger. You help the user log, edit, and delete what they ate.
    You are not a diet coach. Do not give nutrition advice.

    # Voice
    - Plain speech only. No markdown, lists, tables, emoji, or JSON.
    - One to three short sentences. Ask at most one question at a time.
    - Do not say tool names, ids, or raw JSON. Speak food names, amounts, units, and calories.

    # Catalog
    - You may only log dishes returned by search_foods. Never invent a foodId.
    - Always search_foods before log_meal.
    - Use a unit from that food's allowed units (piece, katori, cup, glass, bowl, plate, gram, and so on).
    - If search_foods returns nothing, say it is not in the food list. Do not log.
    - If the match is fuzzy, confirm the dish name, then log.

    # Logging
    - Need a meal type: breakfast, lunch, dinner, or snack. Ask if missing.
    - Need a quantity. Ask if missing.
    - Call list_meals first when they may already have that meal. If the same dish, amount, and unit are already there, do not call log_meal. Say it is already logged.
    - After a successful log, say the dish names, amounts, units, and calories from the tool result. Never guess calories.
    - If log_meal returns unchanged or alreadyPresent, say that it was already there. Do not claim you added it.

    # Edit and delete
    - Call list_meals first so you have mealId and itemId.
    - "Make that three rotis" is an update of that roti line, not a new log.
    - If list_meals already shows that amount, do not call update_item. Say it is already three rotis, or whatever the current amount is.
    - If two matching lines exist, ask which one. Do not guess.
    - For "this morning", pass a from/to range into list_meals.
    - After a successful edit or delete, confirm using the tool result.
    - If update_item returns unchanged, say nothing was changed because it was already that way. Do not claim you updated it.

    # Errors
    - If a tool returns ok false, say the error once in plain language.
    """
)


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=INSTRUCTIONS,
            llm=inference.LLM(model="google/gemma-4-31b-it"),
        )

    @function_tool()
    async def search_foods(self, context: RunContext, query: str) -> dict[str, Any]:
        """Search the food catalog. Call this before logging any dish.

        Args:
            query: What the user said they ate, for example roti, dal, or chai.
        """
        logger.info("search_foods %s", query)
        return await api.search_foods(query)

    @function_tool()
    async def list_meals(
        self,
        context: RunContext,
        from_iso: str | None = None,
        to_iso: str | None = None,
    ) -> dict[str, Any]:
        """List saved meals. Call this before edit or delete so you can pick the right item.

        Args:
            from_iso: Optional start of a time range in ISO format, for this morning or today.
            to_iso: Optional end of a time range in ISO format.
        """
        logger.info("list_meals from=%s to=%s", from_iso, to_iso)
        return await api.list_meals(from_iso, to_iso)

    @function_tool()
    async def log_meal(
        self,
        context: RunContext,
        meal_type: str,
        items: list[dict[str, Any]],
        eaten_at: str | None = None,
    ) -> dict[str, Any]:
        """Save a meal after search_foods has found every dish. Do not send calories.

        Args:
            meal_type: breakfast, lunch, dinner, or snack.
            items: Each item needs foodId from search_foods, quantity as a number, and unit from that food.
            eaten_at: Optional ISO datetime. Use when the user said a time such as this morning.
        """
        logger.info("log_meal %s %s", meal_type, items)
        return await api.log_meal(meal_type, items, eaten_at)

    @function_tool()
    async def update_item(
        self,
        context: RunContext,
        meal_id: str,
        item_id: str,
        quantity: float | None = None,
        unit: str | None = None,
        food_id: str | None = None,
    ) -> dict[str, Any]:
        """Change one dish in a saved meal. Get meal_id and item_id from list_meals.

        Args:
            meal_id: The meal document id from list_meals.
            item_id: The itemId of the dish to change.
            quantity: New amount, if the user changed how much they ate.
            unit: New household unit, if they changed it.
            food_id: New catalog id, only if they swapped the dish.
        """
        logger.info("update_item %s %s", meal_id, item_id)
        return await api.update_item(meal_id, item_id, quantity, unit, food_id)

    @function_tool()
    async def delete_item(
        self,
        context: RunContext,
        meal_id: str,
        item_id: str,
    ) -> dict[str, Any]:
        """Remove one dish. Get meal_id and item_id from list_meals first.

        Args:
            meal_id: The meal document id from list_meals.
            item_id: The itemId of the dish to remove.
        """
        logger.info("delete_item %s %s", meal_id, item_id)
        return await api.delete_item(meal_id, item_id)


server = AgentServer()


@server.rtc_session(agent_name="meal-logger")
async def my_agent(ctx: JobContext):
    ctx.log_context_fields = {
        "room": ctx.room.name,
    }

    session = AgentSession(
        stt=inference.STT(model="assemblyai/universal-3-5-pro", language="en"),
        tts=inference.TTS(
            model="fishaudio/s2.1-pro", voice="fa4c9eb3dccc4806b382b40d61c6b10a"
        ),
        turn_handling=TurnHandlingOptions(
            turn_detection=inference.TurnDetector(),
            interruption={"mode": "adaptive"},
            preemptive_generation={"enabled": True},
        ),
        expressive=True,
    )

    # Cloud noise cancellation needs a real LiveKit room. Console is a local mock
    # room ("console"), so the plugin crashes the job if we attach it here.
    room_options = room_io.RoomOptions()
    if ctx.room.name != "console":
        room_options = room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=ai_coustics.audio_enhancement(
                    model=ai_coustics.EnhancerModel.QUAIL_VF_S
                ),
            ),
        )

    await session.start(
        agent=Assistant(),
        room=ctx.room,
        room_options=room_options,
    )

    await ctx.connect()
    await session.generate_reply(instructions="Greet briefly and ask what they ate.")


if __name__ == "__main__":
    cli.run_app(server)
