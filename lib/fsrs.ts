// FSRS scheduling shared by the Convex backend (authoritative) and the client (button previews).
// Built synchronously from ts-fsrs' parts, the same way its async `DefaultScheduler()` preset is,
// so it also runs inside Convex's runtime without dynamic imports.
import {
  Rating,
  dateChrono,
  defaultLearningSteps,
  defaultRelearningSteps,
  defineScheduler,
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerStatsMiddleware,
} from "ts-fsrs";
import { FSRS7Model, migrateFSRS7Parameters } from "ts-fsrs/models/fsrs-7";

export { Rating };
export type Grade = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
export const GRADE_NAMES: Record<Grade, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

/** Card state as stored in Convex: plain numbers, dates as epoch ms. */
export type StoredCard = {
  stability: number;
  stabilityFast: number;
  difficulty: number;
  state: number; // 0 New, 1 Learning, 2 Review, 3 Relearning
  dueAt: number;
  lastReviewAt: number | null;
  reps: number;
  lapses: number;
  scheduledDays: number;
  learningStep: number;
};

export const STATE_NAMES = ["New", "Learning", "Review", "Relearning"] as const;

const definition = defineScheduler({ model: FSRS7Model, chrono: dateChrono }).use(
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerStatsMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
);

type Scheduler = ReturnType<typeof definition.create>;
const cache = new Map<number, Scheduler>();

export function scheduler(desiredRetention = 0.9): Scheduler {
  const key = Math.round(desiredRetention * 1000) / 1000;
  let s = cache.get(key);
  if (!s) {
    s = definition.create({
      config: {
        fractionalDays: true,
        weights: migrateFSRS7Parameters(),
        enableShortTerm: true,
        numRelearningSteps: defaultRelearningSteps.length,
        desiredRetention: key,
        learningSteps: Array.from(defaultLearningSteps),
        relearningSteps: Array.from(defaultRelearningSteps),
        allowModelOverride: true,
        enableFuzz: true,
        maximumInterval: 36500,
      },
    } as never) as Scheduler;
    cache.set(key, s);
  }
  return s;
}

type LibCard = ReturnType<Scheduler["newCard"]>;

function toLib(card: StoredCard, cardId: string): LibCard {
  return {
    ...card,
    cardId,
    dueAt: new Date(card.dueAt),
    lastReviewAt: card.lastReviewAt === null ? null : new Date(card.lastReviewAt),
    scheduleStatus: (["new", "learning", "review", "relearning"] as const)[card.state] ?? "new",
  } as unknown as LibCard;
}

function fromLib(c: LibCard): StoredCard {
  const x = c as unknown as Record<string, unknown>;
  const date = (v: unknown) => (v instanceof Date ? v.getTime() : v == null ? null : new Date(v as string).getTime());
  return {
    stability: Number(x.stability ?? 0),
    stabilityFast: Number(x.stabilityFast ?? 0),
    difficulty: Number(x.difficulty ?? 0),
    state: Number(x.state ?? 0),
    dueAt: date(x.dueAt) ?? Date.now(),
    lastReviewAt: date(x.lastReviewAt),
    reps: Number(x.reps ?? 0),
    lapses: Number(x.lapses ?? 0),
    scheduledDays: Number(x.scheduledDays ?? 0),
    learningStep: Number(x.learningStep ?? 0),
  };
}

export function newCard(now: number): StoredCard {
  return fromLib(scheduler().newCard({ now: new Date(now) }));
}

export function review(card: StoredCard, cardId: string, grade: Grade, now: number, desiredRetention = 0.9) {
  const r = scheduler(desiredRetention).review({ card: toLib(card, cardId), grade, now: new Date(now) });
  return fromLib(r.card);
}

/** Next due time for each grade, for the grade buttons. */
export function preview(card: StoredCard, cardId: string, now: number, desiredRetention = 0.9): Record<Grade, number> {
  const out = {} as Record<Grade, number>;
  for (const p of scheduler(desiredRetention).preview({ card: toLib(card, cardId), now: new Date(now) })) {
    out[p.grade as Grade] = fromLib(p.card).dueAt;
  }
  return out;
}

/** Probability of recalling the card now (0..1); null for new cards. */
export function retrievability(card: StoredCard, now: number): number | null {
  if (card.state === 0 || card.lastReviewAt === null) return null;
  const s = scheduler();
  const elapsed = Math.max(0, (now - card.lastReviewAt) / 86_400_000);
  return s.model.forgettingCurve(toLib(card, "x") as never, elapsed);
}

export function formatInterval(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return "<1m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30.4)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

/**
 * Suggested grade from how the attempt went. The user can always override.
 * - showed the solution, or any wrong move -> Again
 * - needed a hint -> Hard
 * - clean -> Good; clean and quick -> Easy
 */
export function suggestGrade(a: { mistakes: number; hints: number; revealed: boolean; ms: number; userMoves: number }): Grade {
  if (a.revealed || a.mistakes > 0) return 1;
  if (a.hints > 0) return 2;
  const perMove = a.ms / Math.max(1, a.userMoves);
  return perMove <= 6_000 ? 4 : 3;
}
