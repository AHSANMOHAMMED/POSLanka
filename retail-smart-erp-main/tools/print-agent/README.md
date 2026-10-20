# POSLanka print agent

A tiny Node 20 script that runs on each counter PC. The web POS cannot send raw
bytes to network, shared or serial printers from the browser, so it POSTs the
ESC/POS receipt to this agent on `http://127.0.0.1:9123` and the agent forwards it.

No npm dependencies. Only listens on loopback (127.0.0.1) by default.

## Setup

1. Install Node.js 20 or newer.
2. Copy this folder to the counter PC (for example `C:\poslanka-print-agent` or `/opt/poslanka-print-agent`).
3. Copy `printers.example.json` to `printers.json` and edit it:

```json
{
  "default": "counter1",
  "printers": {
    "counter1": { "type": "tcp",    "host": "192.168.1.50", "port": 9100 },
    "shared":   { "type": "system", "name": "EPSON_TM_T82" },
    "serial":   { "type": "serial", "path": "/dev/ttyUSB0" }
  }
}
```

| type     | fields           | how it prints                                                                                  |
|----------|------------------|------------------------------------------------------------------------------------------------|
| `tcp`    | `host`, `port`   | Raw socket to the printer's JetDirect port (9100 on almost all Ethernet/Wi-Fi receipt printers) |
| `system` | `name`           | Spools the bytes to a temp file and runs `lp -d NAME -o raw` (Linux/macOS) or `print /D:\\localhost\NAME` (Windows, printer must be **shared** under that name) |
| `serial` | `path`           | Writes to the serial device (`/dev/ttyUSB0`, `/dev/ttyS0`, or `\\.\COM3` on Windows). Set the baud rate once with `stty -F /dev/ttyUSB0 9600` on Linux or in Device Manager on Windows |

4. Start it:

```bash
node index.mjs
# POSLanka print agent v1.0.0 listening on http://127.0.0.1:9123
```

5. In the web POS open **Printer** (context bar) → choose **Print agent**, keep the URL
   `http://127.0.0.1:9123`, pick a target and press **Test print**.

Environment overrides: `PRINT_AGENT_PORT`, `PRINT_AGENT_HOST`, `PRINT_AGENT_CONFIG`.

## API

- `GET /health` → `{ ok, version, platform, targets }`
- `GET /printers` → `{ printers: [{ name, type, description, isDefault }], default }`
- `POST /print` body `{ "target": "counter1", "data": "<base64 ESC/POS>" }` → `{ ok, target, bytes }`

CORS is open to any origin because the agent only accepts connections from the local machine.
If the POS is served over HTTPS, Chrome allows `http://127.0.0.1` requests from secure pages
(loopback is treated as potentially trustworthy), so no certificate is needed.

## Autostart

### Windows (Task Scheduler)

1. Open **Task Scheduler** → **Create Task…**
2. General: name `POSLanka Print Agent`, tick **Run whether user is logged on or not** (or
   "Run only when user is logged on" if the printer is shared per user), tick **Hidden**.
3. Triggers: **At log on** (or **At startup**).
4. Actions: **Start a program**
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `index.mjs`
   - Start in: `C:\poslanka-print-agent`
5. Settings: tick **If the task fails, restart every 1 minute**.

Alternative: create a shortcut to `node.exe index.mjs` (Start in the agent folder) inside
`shell:startup`.

### Linux (systemd user service)

```ini
# ~/.config/systemd/user/poslanka-print-agent.service
[Unit]
Description=POSLanka print agent

[Service]
ExecStart=/usr/bin/node /opt/poslanka-print-agent/index.mjs
WorkingDirectory=/opt/poslanka-print-agent
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now poslanka-print-agent
loginctl enable-linger "$USER"      # keep it running without an open session
sudo usermod -aG lp,dialout "$USER"  # access to /dev/usb/lp*, /dev/ttyUSB*
```

### macOS (launchd)

Create `~/Library/LaunchAgents/lk.poslanka.print-agent.plist` with a `ProgramArguments`
array of `/usr/local/bin/node` and the full path to `index.mjs`, `RunAtLoad` true and
`KeepAlive` true, then `launchctl load ~/Library/LaunchAgents/lk.poslanka.print-agent.plist`.

## Troubleshooting

- **"not reachable"** in the POS: the agent is not running or another port is set. `curl http://127.0.0.1:9123/health`.
- **Timed out connecting**: wrong IP or the printer is on another VLAN. Print a self-test from the printer to see its IP.
- **System print failed (Windows)**: the printer must be *shared*; the share name goes in `name`. Set the driver to *Generic / Text Only* so the spooler does not re-render the bytes.
- **Permission denied on /dev/ttyUSB0**: add the user to the `dialout` group and log out/in.
