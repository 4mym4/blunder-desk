#!/usr/bin/env bash
#
# Everything the sync setup needs, after you have logged in once:
#
#     npx supabase login          # opens your browser; the token stays in your keychain
#     scripts/setup-sync.sh       # this
#
# It links a project, applies supabase/migrations (the one table and its
# row-level policies), and prints the URL and anon key to paste into the Sync
# card on the Games tab. Both of those are public values — the anon key is
# designed to sit in a static page, and the policies are what keep rows apart.
#
# Pass a project ref to use one you already have:
#     scripts/setup-sync.sh abcdefghijklmnop
#
# With no ref it offers to create a project, which takes a couple of minutes
# to provision.

set -euo pipefail

SB="npx --yes supabase@latest"
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

$SB projects list >/dev/null 2>&1 || die \
"Not logged in yet. Run this first — it opens your browser and keeps the token
in your keychain, not in this repo:

    npx supabase login"

REF="${1:-}"

if [ -z "$REF" ]; then
  say "Your projects"
  $SB projects list || true
  printf '\nProject ref to use (blank to create a new one): '
  read -r REF
fi

if [ -z "$REF" ]; then
  say "Creating a project"
  $SB orgs list || die "Could not read your organisations."
  printf '\nOrganisation id: ';  read -r ORG
  printf 'Region [eu-west-2]: '; read -r REGION
  REGION="${REGION:-eu-west-2}"
  printf 'Name [blunder-desk]: '; read -r NAME
  NAME="${NAME:-blunder-desk}"

  # Generated rather than chosen: it is only ever used by the CLI, and a
  # password typed into a prompt is one that ends up reused somewhere.
  DBPASS="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
  printf '%s\n' "$DBPASS" > .supabase-db-password
  chmod 600 .supabase-db-password
  say "Database password written to .supabase-db-password (gitignored). Keep it."

  $SB projects create "$NAME" --org-id "$ORG" --region "$REGION" \
      --db-password "$DBPASS" || die "Could not create the project."

  say "Provisioning takes a minute or two. Find the new ref here:"
  $SB projects list
  printf '\nProject ref: '; read -r REF
fi

[ -n "$REF" ] || die "No project ref — nothing to set up."

say "Linking $REF"
$SB link --project-ref "$REF" || die \
"Could not link. If it asked for a database password, it is in
.supabase-db-password for a project this script created."

say "Applying supabase/migrations"
$SB db push || die \
"Could not apply the migration. Nothing is broken — run the contents of
docs/supabase.sql in the project's SQL editor instead, it is the same file."

say "Done. Paste these into the Sync card on the Games tab:"
printf '\n  Project URL : https://%s.supabase.co\n' "$REF"
printf '  Anon key    : '
$SB projects api-keys --project-ref "$REF" 2>/dev/null \
  | awk '/anon/ {print $NF}' | head -1 \
  || printf '(run: npx supabase projects api-keys --project-ref %s)\n' "$REF"

cat <<'EOF'

Google sign-in is the one piece that stays manual — it needs an OAuth client
from Google Cloud Console, under your own Google account:

  1. Supabase dashboard -> Authentication -> Providers -> Google
  2. Authentication -> URL Configuration -> Redirect URLs
     add  https://4mym4.github.io/blunder-desk/

Skip all of that if you only want the sync code: it needs no OAuth at all, and
it already works once the two values above are in the app.
EOF
