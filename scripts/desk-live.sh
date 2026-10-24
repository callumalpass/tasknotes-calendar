#!/usr/bin/env bash
# Live test bench on a desk desktop: the playground, Planner and the TaskNotes
# app (local dev servers, exposed into the desktop) and Obsidian with the
# TaskNotes plugin build (reloaded whenever it is rebuilt).
#
#   scripts/desk-live.sh            # start servers, bring up local/tnc-calendar
#   scripts/desk-live.sh down       # stop the servers (the desktop is kept)
#
# Paths default to the calendar worktrees; override with the variables below.
set -euo pipefail

LIB=${TNC_LIB:-$HOME/projects/tasknotes-calendar}
PLUGIN=${TNC_PLUGIN:-$HOME/projects/tasknotes-worktrees/plugin-tnc-calendar}
PLANNER=${TNC_PLANNER:-$HOME/projects/tasknotes-worktrees/planner-tnc-calendar}
APP=${TNC_APP:-$HOME/projects/tasknotes-worktrees/app-tnc-calendar}
DESKTOP=${TNC_DESKTOP:-local/tnc-calendar}
STATE=${TNC_STATE:-/tmp/tnc-desk}
PLAYGROUND_PORT=4301
PLANNER_PORT=4302
APP_PORT=4303

mkdir -p "$STATE"

stop_servers() {
	local port pid
	for port in $PLAYGROUND_PORT $PLANNER_PORT $APP_PORT; do
		for pid in $(ss -ltnpH "sport = :$port" | grep -oP 'pid=\K[0-9]+' | sort -u); do kill "$pid"; done
	done
}

serve() { # name dir port command...
	local name=$1 dir=$2 port=$3
	shift 3
	if curl -fsS -o /dev/null "http://127.0.0.1:$port/"; then
		echo "$name already on :$port"
		return
	fi
	(cd "$dir" && setsid "$@" </dev/null >"$STATE/$name.log" 2>&1 &)
	for _ in $(seq 60); do
		curl -fsS -o /dev/null "http://127.0.0.1:$port/" && { echo "$name on :$port"; return; }
		sleep 1
	done
	echo "$name did not start; see $STATE/$name.log" >&2
	exit 1
}

if [ "${1:-}" = "down" ]; then
	stop_servers
	exit 0
fi

serve playground "$LIB" $PLAYGROUND_PORT npm run -s playground -- --port $PLAYGROUND_PORT --host 127.0.0.1
serve planner "$PLANNER" $PLANNER_PORT pnpm exec vite --port $PLANNER_PORT --strictPort --host 127.0.0.1
serve app "$APP" $APP_PORT pnpm exec vite --mode e2e --port $APP_PORT --strictPort --host 127.0.0.1

# Fresh copy of the plugin's e2e vault, without its plugin install or workspace.
(cd "$PLUGIN" && npm run -s build >/dev/null)
rm -rf "$STATE/vault"
cp -r "$PLUGIN/tasknotes-e2e-vault" "$STATE/vault"
rm -rf "$STATE/vault/.obsidian/plugins" "$STATE/vault/.obsidian/workspace.json"

if desk ls 2>/dev/null | grep -q "^$DESKTOP\b"; then
	desk start "$DESKTOP" 2>/dev/null || true
else
	desk up "$DESKTOP" --keep --res 1440x900 --vault-fixture "$STATE/vault"
fi
# desk leaves watcher and port-forward daemons running; keep them off our stdout.
desk obsidian "$DESKTOP" --plugin "$PLUGIN" --watch </dev/null >"$STATE/desk.log" 2>&1
for port in $PLAYGROUND_PORT $PLANNER_PORT $APP_PORT; do desk expose "$DESKTOP" $port </dev/null >>"$STATE/desk.log" 2>&1; done
desk chrome "$DESKTOP" "http://localhost:$PLAYGROUND_PORT/" -q </dev/null >>"$STATE/desk.log" 2>&1 || true

cat <<EOF
Desktop: $(desk url "$DESKTOP")
  playground  http://127.0.0.1:$PLAYGROUND_PORT/
  planner     http://127.0.0.1:$PLANNER_PORT/?demo=1
  app         http://127.0.0.1:$APP_PORT/views/TaskNotes%2FViews%2Fcalendar.base%23calendar?demo=60
  obsidian    vault /config/vaults/vault, plugin from $PLUGIN (rebuild with npm run build to reload)
EOF
