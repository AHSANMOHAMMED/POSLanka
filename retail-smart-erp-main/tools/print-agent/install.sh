#!/usr/bin/env bash
# skyERPOS print agent - one-command installer for macOS and Linux.
#
#   curl -fsSL https://<your-app>/print-agent/install.sh | bash
#   curl -fsSL https://<your-app>/print-agent/install.sh | bash -s -- --uninstall
#
# Installs the agent to ~/.skyerpos/print-agent, starts it at login
# (macOS LaunchAgent / systemd --user / ~/.config/autostart) and starts it now.
# No sudo needed: if Node.js 20+ is missing, the official Node.js LTS binary is
# downloaded into ~/.skyerpos/node. Re-run to update.
#
# Env overrides: SKYERPOS_ORIGIN (app URL), SKYERPOS_AUTOSTART=launchd|systemd|xdg|none,
# SKYERPOS_NO_NODE_DOWNLOAD=1 (never download Node.js).
set -eu

# Everything is inside { } so bash reads the whole script before running it
# (safe with curl | bash on a slow connection).
{
ORIGIN="${SKYERPOS_ORIGIN:-__SKYERPOS_ORIGIN__}"
ORIGIN="${ORIGIN%/}"
BASE="$HOME/.skyerpos"
DIR="$BASE/print-agent"
LABEL="com.skyerpos.print-agent"
UNIT="skyerpos-print-agent.service"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNIT_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT"
DESKTOP_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/skyerpos-print-agent.desktop"
HEALTH="http://127.0.0.1:9123/health"
OS="$(uname -s)"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

fetch() { # fetch URL FILE
  if have curl; then curl -fsSL "$1" -o "$2"
  elif have wget; then wget -qO "$2" "$1"
  else die "curl or wget is required"; fi
}

has_systemd_user() { have systemctl && systemctl --user show-environment >/dev/null 2>&1; }

stop_agent() {
  if [ "$OS" = "Darwin" ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  fi
  if has_systemd_user; then systemctl --user stop "$UNIT" >/dev/null 2>&1 || true; fi
  if have pkill; then pkill -f "$DIR/index.mjs" >/dev/null 2>&1 || true; fi
  sleep 1
}

uninstall() {
  say "Removing the skyERPOS print agent"
  stop_agent
  if [ -f "$PLIST" ]; then rm -f "$PLIST"; fi
  if [ -f "$UNIT_FILE" ]; then
    systemctl --user disable "$UNIT" >/dev/null 2>&1 || true
    rm -f "$UNIT_FILE"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  rm -f "$DESKTOP_FILE"
  rm -rf "$DIR"
  say "Done. (Node.js in $BASE/node, if any, was left in place; delete $BASE to remove it too.)"
  exit 0
}

if [ "${1:-}" = "--uninstall" ] || [ "${1:-}" = "-u" ]; then uninstall; fi

case "$ORIGIN" in
  http://*|https://*) ;;
  *) die "Unknown app address '$ORIGIN'. Run the command copied from the Print Labels page." ;;
esac

# ---------------------------------------------------------------- Node.js 20+
node_ok() { # node_ok BIN
  [ -x "$1" ] || have "$1" || return 1
  major="$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "${major:-0}" -ge 20 ] 2>/dev/null
}

NODE=""
if [ -x "$BASE/node/bin/node" ] && node_ok "$BASE/node/bin/node"; then NODE="$BASE/node/bin/node"
elif have node && node_ok "$(command -v node)"; then NODE="$(command -v node)"
fi

if [ -z "$NODE" ]; then
  if [ "${SKYERPOS_NO_NODE_DOWNLOAD:-}" = "1" ]; then
    if [ "$OS" = "Darwin" ]; then hint="brew install node@22"; else hint="sudo apt install nodejs (Debian/Ubuntu: needs v20+) or https://github.com/nvm-sh/nvm"; fi
    die "Node.js 20+ is required. Install it ($hint) and run this command again."
  fi
  case "$OS" in
    Darwin) nos=darwin ;;
    Linux) nos=linux ;;
    *) die "Unsupported system $OS. Install Node.js 20+ and run: node index.mjs" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) narch=x64 ;;
    arm64|aarch64) narch=arm64 ;;
    armv7l) narch=armv7l ;;
    *) die "Unsupported CPU $(uname -m). Install Node.js 20+ yourself (nodejs.org) and run this again." ;;
  esac
  say "Node.js 20+ not found - downloading the official Node.js LTS into $BASE/node (no sudo)"
  tmp="$(mktemp -d)"
  ver=""
  if fetch https://nodejs.org/dist/index.json "$tmp/index.json" 2>/dev/null; then
    ver="$(tr '}' '\n' <"$tmp/index.json" | grep '"lts":"' | head -n 1 | sed 's/.*"version":"\(v[0-9.]*\)".*/\1/')" || ver=""
  fi
  case "$ver" in v[0-9]*) ;; *) ver="v22.12.0" ;; esac
  fetch "https://nodejs.org/dist/$ver/node-$ver-$nos-$narch.tar.gz" "$tmp/node.tgz" \
    || die "Could not download Node.js $ver. Install it yourself (macOS: brew install node, Linux: https://github.com/nvm-sh/nvm) and run this again."
  rm -rf "$BASE/node"
  mkdir -p "$BASE/node"
  tar -xzf "$tmp/node.tgz" -C "$BASE/node" --strip-components=1
  rm -rf "$tmp"
  NODE="$BASE/node/bin/node"
  node_ok "$NODE" || die "The downloaded Node.js does not run on this system."
fi
say "Using Node.js $("$NODE" -v) ($NODE)"

# ---------------------------------------------------------------- agent files
mkdir -p "$DIR"
stop_agent
say "Downloading the print agent from $ORIGIN"
fetch "$ORIGIN/print-agent/index.mjs" "$DIR/index.new.mjs" || die "Could not download $ORIGIN/print-agent/index.mjs"
"$NODE" --check "$DIR/index.new.mjs" || die "The downloaded agent is damaged; try again."
mv -f "$DIR/index.new.mjs" "$DIR/index.mjs"
"$NODE" "$DIR/index.mjs" --allow-origin "$ORIGIN" >/dev/null

# ---------------------------------------------------------------- autostart
mode="${SKYERPOS_AUTOSTART:-}"
if [ -z "$mode" ]; then
  if [ "$OS" = "Darwin" ]; then mode=launchd
  elif has_systemd_user; then mode=systemd
  else mode=xdg; fi
fi

start_background() {
  nohup "$NODE" "$DIR/index.mjs" >>"$DIR/agent.log" 2>&1 </dev/null &
}

case "$mode" in
  launchd)
    mkdir -p "$(dirname "$PLIST")"
    cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/index.mjs</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$DIR/agent.log</string>
</dict>
</plist>
EOF
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST" 2>/dev/null || {
      warn "launchctl could not load $PLIST; starting the agent for this session only"
      start_background
    }
    ;;
  systemd)
    mkdir -p "$(dirname "$UNIT_FILE")"
    cat >"$UNIT_FILE" <<EOF
[Unit]
Description=skyERPOS print agent (local label/receipt printing bridge)
After=network.target

[Service]
ExecStart="$NODE" "$DIR/index.mjs"
WorkingDirectory=$DIR
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
    if systemctl --user daemon-reload && systemctl --user enable "$UNIT" >/dev/null 2>&1 && systemctl --user restart "$UNIT"; then
      :
    else
      warn "systemd --user could not start the agent; using ~/.config/autostart instead"
      rm -f "$UNIT_FILE"
      systemctl --user daemon-reload >/dev/null 2>&1 || true
      mode=xdg
    fi
    ;;
  none) start_background ;;
esac

if [ "$mode" = "xdg" ]; then
  mkdir -p "$(dirname "$DESKTOP_FILE")"
  cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=skyERPOS print agent
Exec="$NODE" "$DIR/index.mjs"
Path=$DIR
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
EOF
  start_background
fi

# ---------------------------------------------------------------- health check
i=0
while [ "$i" -lt 20 ]; do
  if have curl; then
    if curl -fsS "$HEALTH" >/dev/null 2>&1; then ok=1; break; fi
  elif wget -qO- "$HEALTH" >/dev/null 2>&1; then ok=1; break
  fi
  i=$((i + 1))
  sleep 1
done

if [ "${ok:-0}" = "1" ]; then
  printf '\n\033[1;32mThe skyERPOS print agent is running\033[0m (%s, autostart: %s).\n' "$HEALTH" "$mode"
  printf 'Go back to the Print Labels page in the browser and press Retry.\n'
  printf 'Files: %s   Uninstall: curl -fsSL %s/print-agent/install.sh | bash -s -- --uninstall\n' "$DIR" "$ORIGIN"
else
  warn "The agent did not answer on $HEALTH. Log: $DIR/agent.log"
  if [ "$mode" = "systemd" ]; then warn "Check: systemctl --user status $UNIT"; fi
  exit 1
fi
}
