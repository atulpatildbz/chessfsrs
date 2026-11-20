// A year of reviews, one square per day, weeks as columns (Monday on top).
import { useLayoutEffect, useMemo, useRef } from "react";

export function Heatmap({ perDay, todayIndex }: { perDay: { day: number; n: number }[]; todayIndex: number }) {
  const { weeks, max } = useMemo(() => {
    const map = new Map(perDay.map((d) => [d.day, d.n]));
    // Day index 0 (1970-01-01) was a Thursday; shift so columns start on Monday.
    const dow = (d: number) => (d + 3) % 7;
    const end = todayIndex + (6 - dow(todayIndex));
    const start = end - 7 * 52 + 1;
    const weeks: { day: number; n: number }[][] = [];
    for (let d = start; d <= end; d += 7) weeks.push(Array.from({ length: 7 }, (_, i) => ({ day: d + i, n: map.get(d + i) ?? 0 })));
    return { weeks, max: Math.max(1, ...perDay.map((d) => d.n)) };
  }, [perDay, todayIndex]);

  // Narrow screens show the most recent weeks first.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [weeks.length]); // not on every data refresh, or scrolling back to older weeks snaps away

  const level = (n: number) => (n === 0 ? 0 : n <= max * 0.25 ? 1 : n <= max * 0.5 ? 2 : n <= max * 0.75 ? 3 : 4);
  const fills = ["bg-felt-3/50", "bg-brass/30", "bg-brass/55", "bg-brass/80", "bg-brass-2"];

  return (
    <div ref={scroller} className="overflow-x-auto scroll-thin pb-1">
      <div className="flex w-max gap-[3px]" role="img" aria-label="Reviews per day over the last year">
        {weeks.map((w, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {w.map((c) => (
              <div key={c.day} title={c.day > todayIndex ? "" : `${new Date(c.day * 86_400_000).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric" })}: ${c.n} review${c.n === 1 ? "" : "s"}`}
                className={`h-[11px] w-[11px] rounded-[2px] ${c.day > todayIndex ? "opacity-0" : fills[level(c.n)]} ${c.day === todayIndex ? "ring-1 ring-bone/60" : ""}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
