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

git branch -M main
git pull --rebase --autostash origin main

version_file="src/panel.js"
version="$(sed -nE 's/.*<span class="menu-version">v([0-9]+\.[0-9]+\.[0-9]+)<\/span>.*/\1/p' "$version_file")"
if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "Não foi possível identificar uma única versão em $version_file." >&2
  exit 1
fi
major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"
next_version="$major.$minor.$((10#$patch + 1))"
sed -i "s|<span class=\"menu-version\">v${major}\\.${minor}\\.${patch}</span>|<span class=\"menu-version\">v${next_version}</span>|" "$version_file"
echo "Versão do bot: $version → $next_version"

git add .
git commit -m "Bot v$next_version"
git push -u origin main
