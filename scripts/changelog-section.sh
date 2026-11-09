#!/usr/bin/env bash
# Prints the CHANGELOG.md section for a version (without its heading). Fails if it is missing or empty.
# Usage: scripts/changelog-section.sh 0.10.0 [CHANGELOG.md]
set -euo pipefail

version="${1:?usage: $0 X.Y.Z [CHANGELOG.md]}"
file="${2:-CHANGELOG.md}"

notes="$(awk -v v="$version" '
  index($0, "## [" v "]") == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found && /^\[[^]]+\]: / { exit }
  found { print }
' "$file")"

if ! grep -q '[^[:space:]]' <<<"$notes"; then
  echo "$file has no section for [$version]" >&2
  exit 1
fi
printf '%s\n' "$notes"
