# POSLanka print agent

A tiny Node 20 script that runs on each counter PC. The web POS cannot send raw
bytes to network, shared or serial printers from the browser, so it POSTs the
ESC/POS receipt to this agent on `http://127.0.0.1:9123` and the agent forwards it.

No npm dependencies. Only listens on loopback (127.0.0.1) by default.

## One-command install (recommended)

The app serves installers (public, no login) that download this agent from the same host,
allow that host (`extraAllowedOrigins` in printers.json), start it now and at every login:

| OS | Command |
| --- | --- |
| Windows (PowerShell, no admin) | `irm https://<your-app>/print-agent/install.ps1 \| iex` |
| macOS / Linux (no sudo) | `curl -fsSL https://<your-app>/print-agent/install.sh \| bash` |
| Uninstall | `irm https://<your-app>/print-agent/uninstall.ps1 \| iex` / `... install.sh \| bash -s -- --uninstall` |

Windows: Node.js LTS via winget (else MSI as admin, else portable zip), agent in
`%LOCALAPPDATA%\skyERPOS\print-agent`, hidden start via a Startup-folder shortcut (`start-hidden.vbs`).
macOS / Linux: Node.js 20+ or the official tarball in `~/.skyerpos/node`, agent in
`~/.skyerpos/print-agent`, LaunchAgent `com.skyerpos.print-agent` / systemd user unit
`skyerpos-print-agent.service` / `~/.config/autostart` fallback. Re-run to update.
Sources: `install.ps1`, `install.sh` here (`__SKYERPOS_ORIGIN__` is filled in by
`src/app/print-agent/[file]/route.ts`). `node index.mjs --allow-origin <url>` adds an origin.

## Quick start (Windows, manual)

1. Install Node.js LTS from nodejs.org.
2. On the POS open **Barcode → Print Labels**, box *Print directly*: download `index.mjs` and
   `start-windows.cmd` into one folder (or copy this folder), double-click `start-windows.cmd`.
3. Press **Retry**: installed printers are listed, label printers first (Zebra/ZDesigner → ZPL,
   TSC / Xprinter / DBL / Gprinter → TSPL, DPI from the driver name). Click **Print directly**, then
   **Alignment test** (2 rows numbered in print order). Labels then go RAW to the printer: no Chrome
   dialog, no driver paper size, every sticker in order.

Allowed origins also include `https://168-144-216-104.sslip.io` and any `https://*.poslanka.lk`,
`*.skyerpos.com`, `*.retailsmarterp.com` vendor subdomain (only while no explicit `allowedOrigins`
list is configured).

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
| `system` | `name`, `raw?`   | Spools the bytes to a temp file and runs `lp -d NAME -o raw` (Linux/macOS) or `print /D:\\localhost\NAME` (Windows, printer must be **shared** under that name). Set `"raw": true` to use the Windows spooler RAW path instead (no sharing needed) |
| `serial` | `path`           | Writes to the serial device (`/dev/ttyUSB0`, `/dev/ttyS0`, or `\\.\COM3` on Windows). Set the baud rate once with `stty -F /dev/ttyUSB0 9600` on Linux or in Device Manager on Windows |

   `printers.json` is **optional**: every printer installed in Windows / macOS / Linux (with
   its driver) is discovered automatically and shown in the POS printer settings. Add
   entries only for network (`tcp`) or serial printers that are not installed in the OS.

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
- `GET /printers` → `{ printers: [{ name, kind, type, driver, port, isDefault, source, description }], default, platform, discoveryError }`
  - `source: "config"` = targets from `printers.json`; `source: "os"` = printers installed in the OS
    (Windows: `Get-Printer`, fallback `wmic`; macOS/Linux: `lpstat`). Discovery is cached 10 s;
    `?refresh=1` forces a rescan.
- `POST /print` body `{ "target": "counter1", "data": "<base64 ESC/POS>" }` → `{ ok, target, bytes }`
  - `target` may be a `printers.json` key **or the exact name of an installed printer**.
  - On Windows installed printers are printed through the spooler with the `RAW` datatype
    (`OpenPrinter` / `StartDocPrinter` / `WritePrinter` via PowerShell), so the printer does not
    need to be shared and any driver works (Generic / Text Only, Epson/Xprinter thermal, Zebra...).
    On macOS/Linux: `lp -d NAME -o raw`.
  - With no `target` the `printers.json` default is used, else the OS default printer.

### Allowed origins (CORS)

Only browser pages from the origins listed in `allowedOrigins` (in `printers.json`) may call
the agent; requests from any other `Origin` get `403`. The default (no `allowedOrigins`) is
`http://localhost:3000`, `https://app.poslanka.lk`, `https://www.poslanka.lk` and
`https://www.retailsmarterp.com`. `PRINT_AGENT_APP_ORIGIN=https://my.domain` adds an origin
without a config file. To restrict or extend the list explicitly:

```json
{
  "default": "counter1",
  "allowedOrigins": ["https://app.poslanka.lk", "http://localhost:3000"],
  "printers": { "...": {} }
}
```

Origins must match exactly (scheme + host + port, no trailing slash). `"*"` allows any origin
(not recommended). The env var `PRINT_AGENT_ALLOWED_ORIGINS` (comma separated) overrides the
file. Chrome's Private Network Access preflight (`Access-Control-Request-Private-Network`) is
answered with `Access-Control-Allow-Private-Network: true`. Requests without an `Origin`
header (curl, scripts on this PC) are always accepted; the agent only listens on 127.0.0.1.

The agent forwards bytes untouched, so it works for label printers too (TSPL / ZPL / EPL
generated by the barcode label page) - add the label printer as another target.

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
- **Windows spooler print failed / OpenPrinter failed**: the name must match the printer name in
  *Settings → Printers* exactly (pick it from the list in the POS). Win32 error 1801 = unknown printer.
  Some v4 / XPS-only drivers reject RAW jobs - install the vendor driver or *Generic / Text Only*.
- **System print failed (Windows, configured `system` target)**: the printer must be *shared*; the share name goes in `name`. Set the driver to *Generic / Text Only* so the spooler does not re-render the bytes.
- **Permission denied on /dev/ttyUSB0**: add the user to the `dialout` group and log out/in.
