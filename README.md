# Status Page

A rudimentary status page that can be hosted on [SpruceHTTP](https://sprucehttp.com).

## Features

- Monitors
    - Ping (IPv4/IPv6)
    - HTTP(S)
    - TCP Port
- Alerts
    - [Ntfy](https://ntfy.sh)
    - Discord Webhook
- Visual status page
    - Supports multiple status pages with different/shared monitors on one instance

## Config format

See [types/config.js](types/config.js) for JSDoc syntax

```jsonc
{
	"data": {
		"daysToShow": 90, // Number of days to display on the status page
		"purgeOld": true // Whether to purge old data past the last visible day
	},
	"notifications": [
		{
			"pushType": "ntfy", // Type of notification this is, this is a Ntfy notification
			"server": "https://ntfy.sh", // Ntfy server to use, defaults to ntfy.sh
			"topic": "custom_status-nonce" // Ntfy topic to send to, set to something unique
		},
		{
			"pushType": "discord", // Type of notification this is, this is a Discord notification
			"username": "System Status", // Bot username
			"avatarUrl": "https://status.example.com/StatusPageIcon.png", // Avatar URL to use
			"webhook": "https://discord.com/api/webhooks/1001020102401/fakeurl" // Webhook URL
		}
	],
	"monitors": {
		"router": {
			// ID of the monitor
			"active": false, // Whether the monitor is active, this one is not
			"name": "Home router (inactive)", // Display name of the monitor
			"type": "ping", // Type of monitor this is, this is a ping monitor
			"target": "192.168.1.1" // Target of the monitor, an IP address in this case
		},
		"blog": {
			// ID of the monitor
			"active": true, // Whether the monitor is active, this one is
			"name": "Personal blog", // Display name of the monitor
			"type": "http", // Type of monitor this is, this is a HTTP monitor
			"target": "https://blog.example.com" // Target of the monitor, a URL in this case
		},
		"server_ssh": {
			// ID of the monitor
			"active": true, // Whether the monitor is active, this one is
			"name": "Personal blog", // Display name of the monitor
			"type": "port", // Type of monitor this is, this is a TCP port monitor
			"target": "192.168.1.2", // Target of the monitor, an IP address in this case
			"targetPort": 22, // Target port of the port monitor
			"protocol": "tcp" // Protocol of the port. This is always tcp, as udp is not yet supported
		}
	},
	"sites": {
		"status.example.com": {
			// The hostname of the status page site
			"name": "Example.com status page", // Title of the status page
			"monitors": [
				// List of all monitors to display on this status page. Monitors can be shared between pages, and do not have to belong to one.
				"blog"
			]
		},
		"status.infra.example.com": {
			// The hostname of the status page site
			"name": "Example.com infrastructure status page", // Title of the status page
			"monitors": [
				// List of all monitors to display on this status page. Monitors can be shared between pages, and do not have to belong to one.
				"router",
				"server_ssh"
			]
		}
	}
}
```

## Setup

1. Install [SpruceHTTP](https://sprucehttp.com/download)
2. Set up your [site](https://sprucehttp.com/documentation#localsite) to have "sjs" and "esmSJS" set to true
3. Extract the contents of this repo somewhere on your server
4. Create a [config](#config-format) and place it at the root of the cloned repo with the name `statusConfig.json`
5. Point your site to the "web" folder of the repo
6. Set up a cron job to run [batch/statusBatch.js](batch/statusBatch.js) however often you'd like
7. Done!

## Example cron
```
# Run status batch job every 5 minutes
*/5 *	* * *	root	node /var/www/status/batch/statusBatch.js
```

---

Made by a [human](https://stibarc.com/user.html?id=herronjo) without AI
