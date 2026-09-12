import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const calendarUrl = "https://calendar.google.com/calendar/ical/suiei.kagoshima%40gmail.com/public/basic.ics";
const sourceUrl = "https://www.kagoshima-swim.com/";
const outputPath = new URL("../meets.json", import.meta.url);

function todayInJapan() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function decodeText(value = "") {
  return value.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function propertiesOf(block) {
  const props = new Map();
  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const [name] = line.slice(0, colon).split(";");
    const key = name.toUpperCase();
    if (!props.has(key)) props.set(key, []);
    props.get(key).push(line.slice(colon + 1));
  }
  return props;
}

function asDate(value = "") {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function isCompetition(title) {
  if (/総会|会議|研修|講習|合宿|練習会|休館|祝日|申請/.test(title)) return false;
  return /大会|競技会|選手権|記録会|水泳|水球|飛込|飛び込|マスターズ|OWS|JOC|スイム|泳/.test(title);
}

const response = await fetch(calendarUrl, { headers: { "user-agent": "KagoshimaSwimCalendarSync/1.0" } });
if (!response.ok) throw new Error(`ICS取得失敗: HTTP ${response.status}`);

const rawIcs = await response.text();
if (!rawIcs.includes("BEGIN:VCALENDAR") || rawIcs.length < 100) throw new Error("ICSデータが不正です");
const unfolded = rawIcs.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
const today = todayInJapan();
const events = [];

for (const match of unfolded.matchAll(/BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/g)) {
  const props = propertiesOf(match[1]);
  const title = decodeText(props.get("SUMMARY")?.[0] || "");
  const startDate = asDate(props.get("DTSTART")?.[0] || "");
  if (!title || !startDate || startDate < today || !isCompetition(title)) continue;

  const rawEndDate = asDate(props.get("DTEND")?.[0] || "");
  const endDateExclusive = rawEndDate > startDate ? rawEndDate : addOneDay(startDate);
  const location = decodeText(props.get("LOCATION")?.[0] || "");
  const originalUid = decodeText(props.get("UID")?.[0] || "");
  const id = createHash("sha256")
    .update([originalUid, title, startDate, endDateExclusive, location].join("\n"))
    .digest("hex")
    .slice(0, 20);

  events.push({ id, title, startDate, endDateExclusive, location });
}

function addOneDay(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

events.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, "ja"));
if (!events.length) throw new Error("今後の大会が0件です。公開データまたは抽出条件を確認してください");

let updatedAt = new Date().toISOString();
try {
  const existing = JSON.parse(await readFile(outputPath, "utf8"));
  if (JSON.stringify(existing.events) === JSON.stringify(events) && typeof existing.updatedAt === "string") {
    updatedAt = existing.updatedAt;
  }
} catch {
  // First run: create the static calendar data file.
}

const payload = {
  source: sourceUrl,
  updatedAt,
  events,
};
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`wrote ${events.length} upcoming meets to ${outputPath.pathname}`);
