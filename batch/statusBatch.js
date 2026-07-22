#!/usr/bin/env node

import { access, readFile } from "fs/promises";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";
import { exec } from "child_process";
import { Socket } from "net";
import "../types/config.js";
import "../types/db.js";
import "../types/result.js";
import "../types/ntfy.js";
import "../types/discord.js";

const DB_PATH = join(import.meta.dirname, "statusDB.sqlite3");

// Check if database exists
/**
 * @type {boolean}
 */
let dbExists;
try {
	await access(DB_PATH);
	dbExists = true;
} catch (_e) {
	dbExists = false;
}

// Open database
const db = new DatabaseSync(DB_PATH);

// Initialize DB if it didn't exist
if (!dbExists) {
	db.exec(`CREATE TABLE statuses (
		time INTEGER NOT NULL,
		monitor TEXT NOT NULL,
		status INTEGER NOT NULL,
		latency INTEGER,
		error_code TEXT,
		PRIMARY KEY (time, monitor)
	) STRICT;`);
}

// Read config file
/**
 * @type {ConfigFile}
 */
const config = JSON.parse(
	await readFile(join(import.meta.dirname, "..", "statusConfig.json"))
);

/**
 * Ping a target IP address once
 * @param {string} target IP or hostname to ping
 * @returns {Promise<Result>}
 */
function checkPing(target) {
	return new Promise((resolve) => {
		if (process.platform === "win32") {
			exec(`ping -n 1 ${target}`, (error, stdout, stderr) => {
				if (stdout.startsWith("Ping request could not find host")) {
					resolve({
						success: false,
						errorCode: "NXDOMAIN"
					});
					return;
				}
				if (stdout.includes("Request timed out.")) {
					resolve({
						success: false,
						errorCode: "TIMEOUT"
					});
					return;
				}
				if (stdout.includes("Reply from ")) {
					// Extract latency
					const outputMatch = /Average = (?<latency>\d+)ms/gm.exec(
						stdout
					).groups;
					resolve({
						success: true,
						latency: Number.parseInt(outputMatch.latency)
					});
					return;
				}
				if (error) {
					resolve({
						success: false
					});
					return;
				}
				resolve({
					success: false
				});
			});
		} else {
			exec(`ping -c 1 ${target}`, (error, stdout, stderr) => {
				if (stdout.includes("Name or service not known")) {
					resolve({
						success: false,
						errorCode: "NXDOMAIN"
					});
					return;
				}
				if (stdout.includes("100% packet loss")) {
					resolve({
						success: false,
						errorCode: "TIMEOUT"
					});
					return;
				}
				if (stdout.includes(" bytes from ")) {
					// Extract latency
					const outputMatch =
						/rtt min\/avg\/max\/mdev = (\d+\.\d+)\/(?<latency>\d+\.\d+)\/(\d+\.\d+)\/(\d+\.\d+) ms/gm.exec(
							stdout
						).groups;
					resolve({
						success: true,
						latency: Math.round(
							Number.parseFloat(outputMatch.latency)
						)
					});
					return;
				}
				if (error) {
					resolve({
						success: false
					});
					return;
				}
				resolve({
					success: false
				});
			});
		}
	});
}

/**
 * Check that a TCP port is open
 * @param {string} target Hostname to connect to
 * @param {number} targetPort Port to connect to
 * @param {number?} timeout Time to wait for socket
 * @returns {Promise<Result>}
 */
function checkTcpPort(target, targetPort, timeout) {
	return new Promise((resolve) => {
		const start = performance.now();
		const socket = new Socket();

		socket.setTimeout(timeout * 1000 ?? 5000); // 5 seconds default

		socket.connect(targetPort, target, () => {
			const end = performance.now();
			resolve({
				success: true,
				latency: (end - start) | 0 // Cast to normal number
			});
			socket.destroy();
		});

		socket.on("error", (e) => {
			console.log(e);
			resolve({
				success: false
			});
			socket.destroy();
		});

		socket.on("timeout", () => {
			resolve({
				success: false,
				errorCode: "TIMEOUT"
			});
			socket.destroy();
		});
	});
}

/**
 * Check that a target URL resolves and returns a success status code
 * @param {string} target URL to check
 * @param {number?} timeout Time to wait for response
 * @returns {Promise<Result>}
 */
async function checkHttp(target, timeout) {
	try {
		const start = performance.now();
		const fetchResult = await fetch(target, {
			signal: AbortSignal.timeout(timeout ?? 5000)
		});

		if (!fetchResult.ok) {
			return {
				success: false,
				errorCode: `${fetchResult.status} ${fetchResult.statusText}`
			};
		}

		const end = performance.now();
		return {
			success: true,
			latency: (end - start) | 0 // Cast to normal number
		};
	} catch (e) {
		let errorCode = null;

		if (e.cause.code === "ENOTFOUND") {
			errorCode = "NXDOMAIN";
		}

		if (e.cause.code === "UND_ERR_CONNECT_TIMEOUT") {
			errorCode = "TIMEOUT";
		}

		if (e?.cause?.code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
			errorCode = "SELFSIGNED";
		}

		return {
			success: false,
			errorCode
		};
	}
}

/**
 * Send a notification via Ntfy
 * @param {NtfyNotifications} notificationConfig
 * @param {NtfyOptions} options
 */
async function ntfyNotify(notificationConfig, options) {
	return await fetch(
		`${notificationConfig.server ?? "https://ntfy.sh"}/${notificationConfig.topic}`,
		{
			method: "POST",
			headers: {
				"X-Title": options.title,
				"X-Priority": options.priority
			},
			body: options.body
		}
	);
}

/**
 * Send a notification via Discord
 * @param {DiscordNotifications} notificationConfig
 * @param {DiscordOptions} options
 */
async function discordNotify(notificationConfig, options) {
	return await fetch(`${notificationConfig.webhook}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			username: notificationConfig.username,
			avatar_url: notificationConfig.avatarUrl,
			embeds: [
				{
					title: options.title,
					description: options.body,
					color: options.color
				}
			]
		})
	});
}

/**
 * Converts milliseconds to normal human units
 * @param {number} time Number of milliseconds
 * @returns {string} The time expressed in human-readable form
 */
function millisecondsToReadableTime(time) {
	const SECONDS = 1000;
	const MINUTES = 60 * SECONDS;
	const HOURS = 60 * MINUTES;
	const DAYS = 24 * HOURS;
	let timeLeft = time;

	const daysElapsed = Math.floor((timeLeft - (timeLeft % DAYS)) / DAYS);
	timeLeft = timeLeft - daysElapsed * DAYS;

	const hoursElapsed = Math.floor((timeLeft - (timeLeft % HOURS)) / HOURS);
	timeLeft = timeLeft - hoursElapsed * HOURS;

	const minutesElapsed = Math.floor(
		(timeLeft - (timeLeft % MINUTES)) / MINUTES
	);
	timeLeft = timeLeft - minutesElapsed * MINUTES;

	const secondsElapsed = Math.floor(
		(timeLeft - (timeLeft % SECONDS)) / SECONDS
	);
	timeLeft = timeLeft - secondsElapsed * SECONDS;

	const parts = [];
	if (daysElapsed > 0) {
		parts.push(`${daysElapsed} day${daysElapsed !== 1 ? "s" : ""}`);
	}
	if (hoursElapsed > 0) {
		parts.push(`${hoursElapsed} hour${hoursElapsed !== 1 ? "s" : ""}`);
	}
	if (minutesElapsed > 0) {
		parts.push(
			`${minutesElapsed} minute${minutesElapsed !== 1 ? "s" : ""}`
		);
	}
	if (secondsElapsed > 0) {
		parts.push(
			`${secondsElapsed} second${secondsElapsed !== 1 ? "s" : ""}`
		);
	}

	return parts.join(", ");
}

/**
 * Indicate if any status has changed, so we can send a report if necessary
 */
let monitorsChanged = [];

/**
 * Checks a monitor's status
 * @param {string} monitorId
 * @returns {Promise<void>}
 */
async function checkMonitor(monitorId) {
	const monitor = config.monitors[monitorId];

	/**
	 * @type {Result}
	 */
	let result;
	switch (monitor.type) {
		case "ping":
			result = await checkPing(monitor.target);
			break;
		case "port":
			switch (monitor.protocol) {
				case "tcp":
					result = await checkTcpPort(
						monitor.target,
						monitor.targetPort,
						monitor.timeout
					);
					break;
			}
			break;
		case "http":
			result = await checkHttp(monitor.target, monitor.timeout);
			break;
	}

	if (!result) {
		// Bad result somehow, skip
		return;
	}

	/**
	 * @type {boolean}
	 */
	let wasDownBefore;
	// Find latest status for the monitor
	/**
	 * @type {StatusRow}
	 */
	const lastStatus = db
		.prepare(
			"SELECT * FROM statuses WHERE monitor = ? ORDER BY time DESC LIMIT 1"
		)
		.get(monitorId);
	if (!lastStatus) {
		wasDownBefore = false;
	} else {
		wasDownBefore = lastStatus.status === 0;
	}

	if (!result.success && !wasDownBefore) {
		// Notify of outage
		monitorsChanged.push(monitorId);
		for (const notification of config.notifications) {
			if (!notification.monitors.includes(monitorId)) continue;
			try {
				switch (notification.pushType) {
					case "ntfy":
						await ntfyNotify(notification, {
							title: `${monitor.name} down`,
							body: `Error code: ${result.errorCode}`,
							priority: "urgent"
						});
						break;
					case "discord":
						await discordNotify(notification, {
							title: `${monitor.name} down`,
							body: `Error code: ${result.errorCode}`,
							color: 15548997
						});
						break;
				}
			} catch (_e) {}
		}
	}

	if (result.success && wasDownBefore) {
		// Notify of restored service
		monitorsChanged.push(monitorId);
		// Find the last good status, if one exists
		/**
		 * @type {StatusRow}
		 */
		let lastGoodStatus = db
			.prepare(
				"SELECT * FROM statuses WHERE monitor = ? AND status = 1 ORDER BY time DESC LIMIT 1"
			)
			.get(monitorId);
		/**
		 * @type {StatusRow}
		 */
		let firstBadStatus;
		if (!lastGoodStatus) {
			// It was never good, find the first bad status in general
			firstBadStatus = db
				.prepare(
					"SELECT * FROM statuses WHERE monitor = ? AND status = 0 ORDER BY time ASC LIMIT 1"
				)
				.get(monitorId);
		} else {
			// Find the first bad status since it was last good
			firstBadStatus = db
				.prepare(
					"SELECT * FROM statuses WHERE monitor = ? AND status = 0 AND time > ? ORDER BY time ASC LIMIT 1"
				)
				.get(monitorId, lastGoodStatus.time);
		}
		const deltaTime = new Date().getTime() - firstBadStatus.time;
		const time = millisecondsToReadableTime(deltaTime);
		for (const notification of config.notifications) {
			if (!notification.monitors.includes(monitorId)) continue;
			try {
				switch (notification.pushType) {
					case "ntfy":
						await ntfyNotify(notification, {
							title: `${monitor.name} up`,
							body: `Service restored. Was down for ${time}.`,
							priority: "default"
						});
						break;
					case "discord":
						await discordNotify(notification, {
							title: `${monitor.name} up`,
							body: `Service restored. Was down for ${time}.`,
							color: 5763719
						});
						break;
				}
			} catch (_e) {}
		}
	}

	// Insert into database
	db.prepare(
		"INSERT INTO statuses (time, monitor, status, latency, error_code) VALUES (?, ?, ?, ?, ?)"
	).run(
		new Date().getTime(),
		monitorId,
		result.success ? 1 : 0,
		result.latency ?? null,
		result.errorCode ?? null
	);
}

// Run through each monitor and record results
const MAX_PARALLEL = 10;
const pendingMonitorChecks = [];
for (const monitorId in config.monitors) {
	if (!config.monitors[monitorId].active) continue;
	// Queue the check
	pendingMonitorChecks.push(checkMonitor(monitorId));
	if (pendingMonitorChecks.length >= MAX_PARALLEL) {
		// Wait for the ones in-progress
		await Promise.all(pendingMonitorChecks);
		pendingMonitorChecks.length = 0;
	}
}
if (pendingMonitorChecks.length > 0) {
	// Wait for the rest
	await Promise.all(pendingMonitorChecks);
	pendingMonitorChecks.length = 0;
}

if (monitorsChanged.length > 0) {
	// Send an aggregate of statuses
	// Get statuses for each monitor
	const statuses = [];
	for (const monitorId in config.monitors) {
		const monitor = config.monitors[monitorId];
		/**
		 * @type {StatusRow}
		 */
		const lastStatus = db
			.prepare(
				"SELECT * FROM statuses WHERE monitor = ? ORDER BY time DESC LIMIT 1"
			)
			.get(monitorId);
		const status = !lastStatus ? undefined : lastStatus.status === 1;
		statuses.push({
			monitorId,
			name: monitor.name,
			status: status
		});
	}

	for (const notification of config.notifications) {
		if (
			!notification.monitors.some((monitorId) =>
				monitorsChanged.includes(monitorId)
			)
		)
			continue;
		try {
			switch (notification.pushType) {
				case "discord":
					const discordStatusReport = statuses
						.filter((s) =>
							notification.monitors.includes(s.monitorId)
						) // Filter out monitors that belong to this notification channel
						.map((s) => {
							let returnString = "";
							switch (s.status) {
								case undefined:
									returnString += ":white_circle: ";
									break;
								case true:
									returnString += ":green_circle: ";
									break;
								case false:
									returnString += ":red_circle: ";
									break;
							}
							returnString += s.name;
							return returnString;
						})
						.join("\n");
					await discordNotify(notification, {
						title: `Status Report`,
						body: discordStatusReport,
						color: 5793266
					});
					break;
			}
		} catch (_e) {}
	}
}

// Purge old records, if necessary
if (config.data.purgeOld) {
	// Compute oldest time to keep
	const MS_PER_DAY = 86400000;
	let oldestTime = new Date().getTime();
	oldestTime =
		oldestTime -
		(oldestTime % MS_PER_DAY) -
		(config.data.daysToShow - 1) * MS_PER_DAY;
	db.prepare("DELETE FROM statuses WHERE time < ?").run(oldestTime);
}
