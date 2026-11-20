export const DAY = 86_400_000;
/** Start of the study day: 4 am local, like Anki, so a late-night session counts as the same day. */
export const startOfToday = () => {
  const d = new Date();
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  d.setHours(4, 0, 0, 0);
  return d.getTime();
};

/** Re-renders every `ms`, returning a time rounded down to `ms` (keeps Convex query args stable). */
import { useEffect, useState } from "react";
export function useNow(ms = 30_000) {
  const round = () => Math.floor(Date.now() / ms) * ms;
  const [now, setNow] = useState(round);
  useEffect(() => {
    const t = setInterval(() => setNow(round()), Math.min(ms, 15_000));
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function relative(t: number, now = Date.now()): string {
  const d = t - now;
  const abs = Math.abs(d);
  const fmt = (n: number, u: string) => `${Math.round(n)} ${u}${Math.round(n) === 1 ? "" : "s"}`;
  const s = abs < 3_600_000 ? fmt(Math.max(1, abs / 60_000), "minute") : abs < DAY ? fmt(abs / 3_600_000, "hour") : fmt(abs / DAY, "day");
  return d >= 0 ? `in ${s}` : `${s} ago`;
}
