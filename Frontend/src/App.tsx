import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarVisualizer,
  RoomAudioRenderer,
  SessionProvider,
  useAgent,
  useSession,
} from "@livekit/components-react";
import { TokenSource } from "livekit-client";
import "@livekit/components-styles";
import { getMeals } from "./api";
import type { Meal, MealType, Macros } from "./types";
import "./App.css";

const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

function emptyMacros(): Macros {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

function addMacros(a: Macros, b: Macros): Macros {
  return {
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  };
}

function formatMacros(m: Macros): string {
  return `${m.calories.toFixed(0)} kcal · P ${m.protein.toFixed(0)} · C ${m.carbs.toFixed(0)} · F ${m.fat.toFixed(0)}`;
}

export default function App() {
  // Fetches a JWT from Express. LIVEKIT_API_SECRET never ships in this bundle.
  const tokenSource = useMemo(() => TokenSource.endpoint("/api/livekit/token"), []);
  // agentName must match the Python worker's rtc_session name.
  const session = useSession(tokenSource, { agentName: "meal-logger" });

  return (
    <SessionProvider session={session}>
      <Page session={session} />
    </SessionProvider>
  );
}

function Page({ session }: { session: ReturnType<typeof useSession> }) {
  const agent = useAgent();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getMeals();
      setMeals(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load meals");
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Voice writes Mongo on the server; this tab is not told. Poll so Talk and
    // a text-console session in another window both show up without a reload.
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const dayTotals = meals.reduce((sum, meal) => addMacros(sum, meal.totals), emptyMacros());
  const grouped = MEAL_ORDER.map((type) => ({
    type,
    meals: meals.filter((meal) => meal.mealType === type),
  })).filter((group) => group.meals.length > 0);

  const connected = session.connectionState === "connected";

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Meal log</h1>
          <p className="status">
            {connected ? `Agent: ${agent.state}` : "disconnected"}
          </p>
        </div>
        <div className="controls">
          {!connected ? (
            <button type="button" onClick={() => void session.start()}>
              Talk
            </button>
          ) : (
            <button type="button" className="secondary" onClick={() => void session.end()}>
              Disconnect
            </button>
          )}
        </div>
      </header>

      {connected ? (
        <div className="voice">
          {agent.canListen && agent.microphoneTrack ? (
            <BarVisualizer track={agent.microphoneTrack} state={agent.state} barCount={7} />
          ) : (
            <p className="hint">Listening… say what you ate.</p>
          )}
          {/* Plays the agent's TTS track. Without this the session is silent. */}
          <RoomAudioRenderer />
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <p className="totals">Today · {formatMacros(dayTotals)}</p>

      {grouped.length === 0 ? (
        <p className="empty">No meals yet. Press Talk and say what you ate.</p>
      ) : (
        grouped.map((group) => (
          <section key={group.type} className="meal-group">
            <h2>{group.type}</h2>
            {group.meals.map((meal) => (
              <article key={meal._id} className="meal">
                <ul>
                  {meal.items.map((item) => (
                    <li key={item.itemId}>
                      <span>
                        {item.quantity} × {item.foodName} ({item.unit}, {item.grams}g)
                      </span>
                      <span>{formatMacros(item.macros)}</span>
                    </li>
                  ))}
                </ul>
                <p className="meal-total">Meal total · {formatMacros(meal.totals)}</p>
              </article>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
