const UNITS: Array<[string, number]> = [
  ["d", 24 * 60 * 60],
  ["h", 60 * 60],
  ["min", 60],
  ["s", 1],
];

/** "2 min 30 s", "1 d", "0 s". At most two units, largest first. */
export function formatDuration(totalSec: number): string {
  let rest = Math.max(0, Math.floor(totalSec));
  const parts: string[] = [];
  for (const [unit, size] of UNITS) {
    if (parts.length === 2) break;
    const n = Math.floor(rest / size);
    if (n > 0) parts.push(`${n} ${unit}`);
    rest -= n * size;
  }
  return parts.length > 0 ? parts.join(" ") : "0 s";
}

export function formatAgo(since: Date | null, now: Date): string {
  if (!since) return "never";
  return `${formatDuration((now.getTime() - since.getTime()) / 1000)} ago`;
}

/** "2026-01-01 01:02:03" in the given IANA time zone. */
export function formatDateTime(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
