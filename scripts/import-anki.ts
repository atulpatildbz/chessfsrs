// Import chess cards from an Anki collection, with their schedule and review history.
//
//   npx tsx scripts/import-anki.ts --email you@example.com [--prod] [--dry-run] [path/to/collection.anki2]
//
// Reads every note type with a "PGN" field ("Chess 2.0", AnkiChess). Defaults to the desktop
// profile "User 1". The file is copied first, so Anki may stay open (sync it first for fresh data).
// Puzzles already in chessfsrs (same position and line) are skipped, so re-running is safe.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { noteToPuzzle, replay, withAnkiSchedule, type AnkiCard, type AnkiReview } from "../lib/anki";
import { dedupeKey } from "../lib/puzzle";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const email = args[args.indexOf("--email") + 1];
if (!args.includes("--email") || !email) throw new Error("Pass --email <allowlisted email>");
const path = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--email")
  ?? join(homedir(), "Library/Application Support/Anki2/User 1/collection.anki2");

const copy = join(mkdtempSync(join(tmpdir(), "anki-")), "collection.anki2");
copyFileSync(path, copy);
const db = new DatabaseSync(copy, { readOnly: true });

// Filtered here, not in SQL: Anki's name columns use its own "unicase" collation.
const types = db.prepare("select ntid, ord, name from fields").all().filter((r) => r.ord === 0 && r.name === "PGN").map((r) => Number(r.ntid));
if (!types.length) throw new Error("No note type with a PGN field in this collection");
const notes = db.prepare(`select id, flds, tags from notes where mid in (${types.join(",")}) order by id`).all();
const crt = Number(db.prepare("select crt from col").get()!.crt);
const cardOf = db.prepare("select id, type, queue, due, ivl, data from cards where nid = ? order by ord limit 1");
const revlogOf = db.prepare("select id, ease, type, ivl, time from revlog where cid = ?");

const items = [];
const failed: string[] = [];
const seen = new Set<string>();
for (const n of notes) {
  const res = noteToPuzzle(String(n.flds).split("\x1f"), String(n.tags).trim().split(/\s+/).filter(Boolean));
  if (!res.ok) {
    failed.push(`note ${n.id}: ${res.error}`);
    continue;
  }
  const key = dedupeKey(res.puzzle);
  if (seen.has(key)) continue;
  seen.add(key);
  const c = cardOf.get(n.id as number);
  if (!c) continue;
  const createdAt = Number(n.id);
  const { card, log } = replay(revlogOf.all(c.id as number) as unknown as AnkiReview[], String(c.id), createdAt);
  const scheduled = withAnkiSchedule(card, c as unknown as AnkiCard, crt);
  items.push({ input: res.puzzle, createdAt, suspended: c.queue === -1, card: scheduled, reviews: log });
}

const states = ["new", "learning", "review", "relearning"];
const byState = items.reduce<Record<string, number>>((m, i) => ((m[states[i.card.state]] = (m[states[i.card.state]] ?? 0) + 1), m), {});
const dueNow = items.filter((i) => i.card.state > 0 && i.card.dueAt <= Date.now()).length;
console.log(`${notes.length} PGN notes → ${items.length} puzzles (${failed.length} unreadable, ${notes.length - items.length - failed.length} duplicates)`);
console.log(`  ${JSON.stringify(byState)}, ${items.filter((i) => i.input.game).length} from games, ${items.filter((i) => i.suspended).length} suspended, ${dueNow} due now`);
console.log(`  ${items.reduce((s, i) => s + i.reviews.length, 0)} reviews of history`);
failed.forEach((f) => console.log("  skipped", f));
if (flag("--dry-run")) process.exit(0);

let added = 0, duplicates = 0;
for (let i = 0; i < items.length; i += 20) {
  const out = execFileSync("npx", ["convex", "run", ...(flag("--prod") ? ["--prod"] : []), "anki:importBatch", JSON.stringify({ email, items: items.slice(i, i + 20) })], { encoding: "utf8" });
  const r = JSON.parse(out.slice(out.indexOf("{")));
  added += r.added;
  duplicates += r.duplicates;
  process.stdout.write(`\r  imported ${added}, already there ${duplicates}`);
}
console.log();
