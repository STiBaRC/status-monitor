import sjs from "sprucehttp_sjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import "../types/config.js";
import "../types/db.js";

/**
 * Cleanly handle errors and exit
 * @param {Error | unknown} error The error or rejection reason
 */
async function fail(error) {
	await sjs.writeStatusLine(500);
	await sjs.writeHeader("Content-Type", "text/plain");
	await sjs.writeData("An unhandled error occurred!\n");
	await sjs.writeData(error.stack);
	process.exit(0);
}
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

/**
 * Generates a color hex value that represents the percentage, with red being 0 and green being 100
 * @param {number} percentage Number between 0 and 100
 * @param {number} midpoint Percentage where the color should be yellow
 * @returns {string} CSS color hex
 */
function percentageToColor(percentage, midpoint = 98) {
	// Clamp inputs to valid values
	const percent = Math.max(0, Math.min(100, percentage));
	const threshold = Math.max(1, Math.min(99, midpoint));

	const red = Math.round(
		255 * (percent <= threshold ? 1 : (100 - percent) / (100 - threshold))
	);
	const green = Math.round(
		255 * (percent >= threshold ? 1 : percent / threshold)
	);
	return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}00`;
}

const MILLISECONDS_PER_DAY = 86400000;
const DB_PATH = join(import.meta.dirname, "..", "batch", "statusDB.sqlite3");
const db = new DatabaseSync(DB_PATH);

// Read config file
/**
 * @type {ConfigFile}
 */
const config = JSON.parse(
	await readFile(join(import.meta.dirname, "..", "statusConfig.json"))
);

// Identify which site this is
const siteConfig = config.sites[sjs.headers.host];
if (siteConfig === undefined) {
	// Not one we've defined
	await sjs.writeStatusLine(404);
	await sjs.writeHeader("Content-Type", "text/plain");
	await sjs.writeData("This site is not configured.");
	process.exit(0);
}

/**
 * Escapes a string for safe insertion into HTML
 * @param {string} str String to escape
 * @returns {string} Escaped string
 */
function htmlEscape(str) {
	return str
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("'", "&apos;")
		.replaceAll('"', "&quot;");
}

let body = `<!DOCTYPE html>
<html>
<title>${htmlEscape(siteConfig.name)}</title>
<body>
<h1>${htmlEscape(siteConfig.name)}</h1>
<hr>\n`;

// Get records for each monitor
// Used to constrain results to only monitors belonging to this site
const placeholders = siteConfig.monitors.map(() => "?").join(", ");

// Figure out when to start looking (end time is end of current day in UTC, so work backwards)
let startTimestamp = new Date().getTime();
startTimestamp =
	startTimestamp -
	(startTimestamp % MILLISECONDS_PER_DAY) -
	(config.data.daysToShow - 1) * MILLISECONDS_PER_DAY;

/**
 * Get all days for all monitors in one lookup
 * @type {DailyRow[]}
 */
const dailyRows = db
	.prepare(
		`SELECT 
			monitor,
			FLOOR((time - ?) / ${MILLISECONDS_PER_DAY}) AS day_index,
			SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS good_statuses,
			SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS bad_statuses,
			AVG(CASE WHEN status = 1 THEN latency ELSE NULL END) AS average_latency
		FROM statuses
		WHERE monitor IN (${placeholders}) AND time >= ?
		GROUP BY monitor, day_index`
	)
	.all(startTimestamp, ...siteConfig.monitors, startTimestamp);

/**
 * Map of monitor + day index -> DailyRow record for fast lookup
 * @type {Map<string, Map<number, DailyRow>}
 */
const statsByMonitor = new Map();
for (const row of dailyRows) {
	if (!statsByMonitor.has(row.monitor)) {
		statsByMonitor.set(row.monitor, new Map());
	}
	statsByMonitor.get(row.monitor).set(row.day_index, row);
}

/**
 * Get last row for all monitors in one lookup
 * @type {LastRow[]}
 */
const latestRows = db
	.prepare(
		`SELECT s.monitor, s.status, s.time
		FROM statuses s
		INNER JOIN (
			SELECT monitor, MAX(time) AS max_time
			FROM statuses
			WHERE monitor IN (${placeholders})
			GROUP BY monitor
		) latest ON s.monitor = latest.monitor AND s.time = latest.max_time`
	)
	.all(...siteConfig.monitors);

/**
 * Map of monitor -> LastRow for fast lookup
 * @type {Map<string, LastRow>}
 */
const latestByMonitor = new Map(latestRows.map((r) => [r.monitor, r]));
// Store highest time seen
let maxUpdatedTime = 0;

for (const monitorId of siteConfig.monitors) {
	const monitorCfg = config.monitors[monitorId];
	const lastStatus = latestByMonitor.get(monitorId);
	if (lastStatus && lastStatus.time > maxUpdatedTime) {
		maxUpdatedTime = lastStatus.time;
	}

	let statusColor = "#999999";
	let statusText = "Disabled";
	if (monitorCfg.active && lastStatus) {
		statusColor = lastStatus.status === 1 ? "#00ff00" : "#ff0000";
		statusText = lastStatus.status === 1 ? "Up" : "Down";
	}

	body += `<h2 id="${htmlEscape(monitorId)}"><div style="display: inline-block; margin-right: 5px; width: 20px; height: 20px; border-radius: 50%; background-color: ${htmlEscape(statusColor)};" title="${htmlEscape(statusText)}"></div>${htmlEscape(monitorCfg.name)}</h2>\n<div style="font-size: 0px">\n`;

	const monitorDays = statsByMonitor.get(monitorId);
	let currentDayStart = startTimestamp;

	for (let i = 0; i < config.data.daysToShow; i++) {
		const dayStats = monitorDays?.get(i);
		const good = dayStats?.good_statuses ?? 0;
		const bad = dayStats?.bad_statuses ?? 0;
		const avgLatency = dayStats?.average_latency ?? null;

		let color = "#999999";
		const dateLabel = new Date(currentDayStart)
			.toUTCString()
			.replace(" 00:00:00", "");
		let title = `${dateLabel} - No data`;

		if (good + bad > 0) {
			const percentage = (good / (good + bad)) * 100;
			color = percentageToColor(percentage);
			title = `${dateLabel} - ${Math.round(percentage)}%`;
		}
		if (avgLatency !== null) {
			title += ` - ${Math.round(avgLatency)} ms`;
		}

		body += `<div style="display: inline-block; margin-right: 1px; height: 25px; width: 10px; background-color: ${htmlEscape(color)};" title="${htmlEscape(title)}"></div>\n`;
		currentDayStart += MILLISECONDS_PER_DAY;
	}
	body += "</div>\n";
}

body += `<hr>
Last updated: ${maxUpdatedTime ? new Date(maxUpdatedTime).toUTCString() : "Never"}
</body>
</html>`;

await sjs.writeStatusLine("200");
await sjs.writeHeader("Content-Type", "text/html");
await sjs.writeData(body);
