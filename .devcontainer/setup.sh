#!/usr/bin/env bash
# Runs once per container create/rebuild (see postCreateCommand in devcontainer.json).
#
# ~/.claude and ~/.claude.json are bind-mounted directly from the host (see devcontainer.json)
# so Claude Code's config/memory/session data is the same live data on both sides — nothing to
# migrate or persist here. The only remaining job a mount can't do on its own:
#
#  SSH keys are bind-mounted read-only at ~/.ssh-host so this container can never write back to
#  the host's real ~/.ssh. ssh itself refuses to use private keys that are group/world-readable,
#  which a straight bind mount often is (host permissions carry through, and mounting read-only
#  means we can't chmod in place even if they weren't). So: copy into a real, writable ~/.ssh and
#  fix permissions there.
set -euo pipefail

HOME_DIR="${HOME:-/home/node}"

if [ -d "$HOME_DIR/.ssh-host" ]; then
  mkdir -p "$HOME_DIR/.ssh"
  cp -rT "$HOME_DIR/.ssh-host" "$HOME_DIR/.ssh"
  chmod 700 "$HOME_DIR/.ssh"
  find "$HOME_DIR/.ssh" -type f -exec chmod 600 {} \;
  find "$HOME_DIR/.ssh" -type d -exec chmod 700 {} \;
  echo "SSH keys copied from host into $HOME_DIR/.ssh with correct permissions."
else
  echo "No ~/.ssh-host mount found; skipping SSH key setup."
fi
