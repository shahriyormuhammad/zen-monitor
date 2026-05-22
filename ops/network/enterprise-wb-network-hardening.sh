#!/usr/bin/env bash
set -euo pipefail

HOST_DPORT_GROUPS=(
  "3457,3458,3459,3460,3461,54321,54322,54324,8288,8289,8290,8291,8292,8293,8294"
  "8295,50052,50053,6080,5900"
)
OLD_HOST_DPORTS="3457,8288,8289,50052,50053,6080,5900"
DOCKER_PUBLISHED_PORTS=(54321 54322 54324)

remove_input_rules() {
  local ports="$1"
  while iptables -D INPUT ! -i lo -p tcp -m multiport --dports "$ports" -j REJECT --reject-with tcp-reset 2>/dev/null; do :; done
  while iptables -D INPUT ! -i lo -p tcp -m multiport --dports "$ports" -j DROP 2>/dev/null; do :; done
}

for ports in "${HOST_DPORT_GROUPS[@]}"; do
  remove_input_rules "$ports"
done
remove_input_rules "$OLD_HOST_DPORTS"
for ports in "${HOST_DPORT_GROUPS[@]}"; do
  iptables -I INPUT 1 ! -i lo -p tcp -m multiport --dports "$ports" -j REJECT --reject-with tcp-reset
done

for p in "${DOCKER_PUBLISHED_PORTS[@]}"; do
  while iptables -D DOCKER-USER -i eth0 -p tcp -m conntrack --ctorigdstport "$p" -j REJECT --reject-with tcp-reset 2>/dev/null; do :; done
  while iptables -D DOCKER-USER -i eth0 -p tcp -m conntrack --ctorigdstport "$p" -j DROP 2>/dev/null; do :; done
  while iptables -D DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" -j REJECT --reject-with tcp-reset 2>/dev/null; do :; done
  while iptables -D DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" -j DROP 2>/dev/null; do :; done
  iptables -I DOCKER-USER 1 -i eth0 -p tcp -m conntrack --ctorigdstport "$p" -j REJECT --reject-with tcp-reset
done
while iptables -D DOCKER-USER -p tcp -m multiport --dports 54321,54322,54324 -j DROP 2>/dev/null; do :; done
while iptables -D DOCKER-USER -p tcp -m multiport --dports 54321,54322,54324 -j REJECT --reject-with tcp-reset 2>/dev/null; do :; done

if command -v ip6tables >/dev/null 2>&1; then
  for ports in "${HOST_DPORT_GROUPS[@]}"; do
    while ip6tables -D INPUT ! -i lo -p tcp -m multiport --dports "$ports" -j REJECT --reject-with tcp-reset 2>/dev/null; do :; done
    while ip6tables -D INPUT ! -i lo -p tcp -m multiport --dports "$ports" -j DROP 2>/dev/null; do :; done
  done
  while ip6tables -D INPUT ! -i lo -p tcp -m multiport --dports "$OLD_HOST_DPORTS" -j REJECT --reject-with tcp-reset 2>/dev/null; do :; done
  while ip6tables -D INPUT ! -i lo -p tcp -m multiport --dports "$OLD_HOST_DPORTS" -j DROP 2>/dev/null; do :; done
  for ports in "${HOST_DPORT_GROUPS[@]}"; do
    ip6tables -I INPUT 1 ! -i lo -p tcp -m multiport --dports "$ports" -j REJECT --reject-with tcp-reset || true
  done
  for p in "${DOCKER_PUBLISHED_PORTS[@]}"; do
    while ip6tables -D DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" -j REJECT --reject-with tcp-reset 2>/dev/null; do :; done
    while ip6tables -D DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" -j DROP 2>/dev/null; do :; done
    ip6tables -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport "$p" -j REJECT --reject-with tcp-reset || true
  done
  while ip6tables -D DOCKER-USER -p tcp -m multiport --dports 54321,54322,54324 -j DROP 2>/dev/null; do :; done
  while ip6tables -D DOCKER-USER -p tcp -m multiport --dports 54321,54322,54324 -j REJECT --reject-with tcp-reset 2>/dev/null; do :; done
fi
