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

function MacroPills({ m }: { m: Macros }) {
  return (
    <div className="macros">
      <b>{Math.round(m.calories)} kcal</b>
      <span>P {m.protein.toFixed(0)}</span>
      <span>C {m.carbs.toFixed(0)}</span>
      <span>F {m.fat.toFixed(0)}</span>
    </div>
  );
}

function statusLabel(connected: boolean, state: string): string {
  if (!connected) return "Disconnected";
  if (state === "listening") return "Listening";
  if (state === "thinking" || state === "generating") return "Thinking";
  if (state === "speaking") return "Speaking";
  return state.replaceAll("_", " ");
}

function dayKey(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabel(key: string): string {
  const today = dayKey(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = dayKey(y);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [yy, mm, dd] = key.split("-");
  return new Date(Number(yy), Number(mm) - 1, Number(dd)).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
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

  const byDay = meals.reduce<Record<string, Meal[]>>((acc, meal) => {
    const key = dayKey(meal.eatenAt);
    (acc[key] ??= []).push(meal);
    return acc;
  }, {});
  const days = Object.keys(byDay).sort((a, b) => (a < b ? 1 : -1));

  const connected = session.connectionState === "connected";

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <p className="eyebrow">Beet</p>
          <h1>Meal log</h1>
          <p className={`status${connected ? " live" : ""}`}>
            {statusLabel(connected, agent.state)}
          </p>
        </div>
        {!connected ? (
          <button type="button" className="talk" onClick={() => void session.start()}>
            Talk
          </button>
        ) : (
          <button type="button" className="talk hangup" onClick={() => void session.end()}>
            Hang up
          </button>
        )}
      </header>

      {connected ? (
        <div className="voice">
          {agent.canListen && agent.microphoneTrack ? (
            <BarVisualizer track={agent.microphoneTrack} state={agent.state} barCount={7} />
          ) : (
            <p className="hint">Say what you ate — log, edit, or delete.</p>
          )}
          <RoomAudioRenderer />
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {days.length === 0 ? (
        <div className="empty">
          <strong>Nothing logged yet</strong>
          Press Talk and say what you ate.
        </div>
      ) : (
        days.map((key) => {
          const dayMeals = byDay[key];
          const dayTotals = dayMeals.reduce(
            (sum, meal) => addMacros(sum, meal.totals),
            emptyMacros(),
          );
          const grouped = MEAL_ORDER.map((type) => ({
            type,
            meals: dayMeals.filter((meal) => meal.mealType === type),
          })).filter((group) => group.meals.length > 0);

          return (
            <section key={key} className="day-group">
              <div className="day-head">
                <h2>{dayLabel(key)}</h2>
                <span className="day-kcal">{Math.round(dayTotals.calories)} kcal</span>
              </div>
              {grouped.map((group) => (
                <div key={group.type} className="meal-group">
                  <h3>{group.type}</h3>
                  {group.meals.map((meal) => (
                    <article key={meal._id} className="meal">
                      <ul>
                        {meal.items.map((item) => (
                          <li key={item.itemId}>
                            <div>
                              <span className="item-name">{item.foodName}</span>
                              <span className="item-meta">
                                {item.quantity} {item.unit} · {item.grams}g
                              </span>
                            </div>
                            <MacroPills m={item.macros} />
                          </li>
                        ))}
                      </ul>
                      <p className="meal-total">
                        <span>Meal total</span>
                        <MacroPills m={meal.totals} />
                      </p>
                    </article>
                  ))}
                </div>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}
