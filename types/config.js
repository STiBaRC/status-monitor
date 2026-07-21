/**
 * @typedef {Object} ConfigFile
 * @property {DataConfig} data Data config
 * @property {Notifications[]} notifications Notifications config
 * @property {Record<string, Monitor>} monitors Monitors config
 * @property {Record<string, Site>} sites Sites config
 */

/**
 * @typedef {Object} DataConfig
 * @property {number} daysToShow Number of days to show on the status page
 * @property {boolean} purgeOld Whether to purge records older than the last day shown
 */

/**
 * @typedef {NtfyNotifications | DiscordNotifications} Notifications
 */

/**
 * @typedef {Object} NtfyNotifications
 * @property {"ntfy"} pushType The type of push notification
 * @property {string} server What Ntfy server to use ("https://ntfy.sh" if unsure)
 * @property {string} topic The Ntfy topic to send to
 */

/**
 * @typedef {Object} DiscordNotifications
 * @property {"discord"} pushType The type of push notification
 * @property {string} username What username to send as
 * @property {string} avatarUrl What avatar to use
 * @property {string} webhook The Discord webhook URL
 */

/**
 * @typedef {PingMonitor | PortMonitor | HttpMonitor} Monitor
 */

/**
 * @typedef {Object} PingMonitor
 * @property {boolean} active Whether the monitor is active
 * @property {string} name The monitor display name
 * @property {"ping"} type The monitor type
 * @property {string} target The target of the monitor
 */

/**
 * @typedef {Object} PortMonitor
 * @property {boolean} active Whether the monitor is active
 * @property {string} name The monitor display name
 * @property {"port"} type The monitor type
 * @property {string} target The target of the monitor
 * @property {number} targetPort The target port of the monitor
 * @property {"tcp"} protocol Currently only TCP, UDP may be supported later
 */

/**
 * @typedef {Object} HttpMonitor
 * @property {boolean} active Whether the monitor is active
 * @property {string} name The monitor display name
 * @property {"http"} type The monitor type
 * @property {string} target The target of the monitor
 */

/**
 * @typedef {Object} Site
 * @property {string} name Display name of the site
 * @property {string[]} monitors List of monitors to be displayed on the site
 */