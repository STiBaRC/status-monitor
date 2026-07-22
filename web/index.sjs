import sjs from "sprucehttp_sjs";
import { readFile } from "fs/promises";
import { join } from "path";
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
 * @returns {string} CSS color hex
 */
function percentageToColor(percentage) {
	const red = Math.round(
		255 * (percentage <= 50 ? 1 : 1 - (percentage - 50) / 50)
	);
	const green = Math.round(255 * (percentage >= 50 ? 1 : percentage / 50));
	return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}00`;
}

const MILLISECONDS_PER_DAY = 86400000;
const now = new Date();
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
// Figure out when to start looking (end time is end of current day in UTC, so work backwards)
let startTimestamp = new Date().getTime();
startTimestamp =
	startTimestamp -
	(startTimestamp % MILLISECONDS_PER_DAY) -
	(config.data.daysToShow - 1) * MILLISECONDS_PER_DAY;

for (const monitorId of siteConfig.monitors) {
	body += `<h2 id="${htmlEscape(monitorId)}">${htmlEscape(config.monitors[monitorId].name)}</h2>\n`;
	let startTime = startTimestamp;
	let endTime = startTime + MILLISECONDS_PER_DAY - 1; // Just before start of next day
	for (let i = 0; i < config.data.daysToShow; i++) {
		// Compute uptime percentage
		const goodStatuses = db
			.prepare(
				`SELECT * FROM statuses WHERE monitor = ? AND status = 1 AND time >= ? AND time <= ?`
			)
			.all(monitorId, startTime, endTime).length;
		const badStatuses = db
			.prepare(
				`SELECT * FROM statuses WHERE monitor = ? AND status = 0 AND time >= ? AND time <= ?`
			)
			.all(monitorId, startTime, endTime).length;
		/**
		 * @type {number}
		 */
		const averageLatency = db
			.prepare(
				`SELECT AVG(latency) AS average_latency FROM statuses WHERE monitor = ? AND status = 1 AND latency IS NOT NULL AND time >= ? AND time <= ?`
			)
			.get(monitorId, startTime, endTime).average_latency;
		// Fallback color for no data
		let color = "#999999";
		// Block title
		let title = `${new Date(startTime).toUTCString().replace(" 00:00:00", "")} - No data`;
		if (goodStatuses + badStatuses > 0) {
			// Compute color if there is data
			const percentage =
				(goodStatuses / (goodStatuses + badStatuses)) * 100;
			color = percentageToColor(percentage);
			title = `${new Date(startTime).toUTCString().replace(" 00:00:00", "")} - ${Math.round(percentage)}%`;
		}
		if (averageLatency !== null) {
			title += ` - ${Math.round(averageLatency)} ms`;
		}
		// Insert colored rectangle
		body += `<div style="display: inline-block; margin-right: 1px; height: 25px; width: 10px; background-color: ${htmlEscape(color)};" title="${htmlEscape(title)}"></div>\n`;
		// Increase start and end time
		startTime += MILLISECONDS_PER_DAY;
		endTime = startTime + MILLISECONDS_PER_DAY - 1; // Just before start of next day
	}
}

const placeholders = siteConfig.monitors.map(() => "?").join(", ");
/**
 * @type {StatusRow}
 */
let lastRecord = db
	.prepare(
		`SELECT * FROM statuses WHERE monitor IN (${placeholders}) ORDER BY time DESC LIMIT 1`
	)
	.get(...siteConfig.monitors);

body += `<hr>
Last updated: ${new Date(lastRecord?.time).toUTCString()}
</body>
</html>`;

await sjs.writeStatusLine("200");
await sjs.writeHeader("Content-Type", "text/html");
await sjs.writeData(body);
