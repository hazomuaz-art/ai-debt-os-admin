#!/usr/bin/env bash
set -euo pipefail

external_interface="${1:-eth0}"
chain="AI_DEBT_DOCKER_GUARD"

apply_guard() {
  local command="$1"

  "$command" -nL DOCKER-USER >/dev/null 2>&1 || return 0
  "$command" -N "$chain" 2>/dev/null || true
  "$command" -F "$chain"

  # Docker-published management/API ports must only be reached through local
  # reverse proxies or by services running on the VPS itself.
  # DOCKER-USER runs after DNAT, so match the original published port rather
  # than the container's translated port (for example 32771 -> 3000).
  local published_port
  for published_port in 5678 32769 32770 32771; do
    "$command" -A "$chain" -i "$external_interface" -p tcp -m conntrack \
      --ctorigdstport "$published_port" -j DROP
  done
  "$command" -A "$chain" -j RETURN

  "$command" -C DOCKER-USER -j "$chain" 2>/dev/null || \
    "$command" -I DOCKER-USER 1 -j "$chain"
}

apply_guard iptables
apply_guard ip6tables
