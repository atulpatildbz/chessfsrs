// useQuery returns undefined while new arguments load. For queries whose args tick with the clock,
// keep showing the previous result instead, so the page doesn't blank (or remount) every tick.
import { useRef } from "react";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";

export function useStableQuery<Q extends FunctionReference<"query">>(query: Q, args: Q["_args"]): Q["_returnType"] | undefined {
  const result = useQuery(query, args);
  const last = useRef(result);
  if (result !== undefined) last.current = result;
  return last.current;
}
