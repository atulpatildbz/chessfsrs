// Figurine algebraic notation, as chess books print it: Nxe4 -> ♘xe4.
const FIG: Record<string, string> = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘" };
export const figurine = (san: string) => san.replace(/^[KQRBN]/, (p) => FIG[p]).replace(/=([QRBN])/, (_, p) => `=${FIG[p]}`);

export const sideName = (c: "w" | "b") => (c === "w" ? "White" : "Black");

/** "+1.5", "−3.2", "#3" from the user's point of view. */
export function formatEval(cp: number, mate?: number | null): string {
  if (mate) return `#${Math.abs(mate)}`;
  if (Math.abs(cp) >= 9000) return cp > 0 ? "mating" : "getting mated";
  const v = cp / 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
}
