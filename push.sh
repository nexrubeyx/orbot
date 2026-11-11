#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

remote_url="https://github.com/nexrubeyx/orbot.git"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$remote_url"
else
  git remote add origin "$remote_url"
fi

git add .
if ! git diff --cached --quiet; then
  git commit -m "Primeiro commit"
fi

git branch -M main
git pull --rebase origin main
git push -u origin main
