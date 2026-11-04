#!/usr/bin/env bash
set -euo pipefail

REPO=komtaki/lensdiff
ASSET=lensdiff.tgz

fail() {
  echo "error: $*" >&2
  exit 1
}

cd "$(git rev-parse --show-toplevel)"

[[ -z "$(git status --porcelain)" ]] || fail "working tree is not clean"

branch=$(git branch --show-current)
[[ "$branch" == main ]] || fail "not on main (current: ${branch:-detached HEAD})"

git fetch --quiet --tags origin main
head_sha=$(git rev-parse HEAD)
[[ "$head_sha" == "$(git rev-parse origin/main)" ]] || fail "main is not in sync with origin/main"

version=$(node -p "require('./package.json').version")
tag="lensdiff-v${version}"

if git rev-parse --quiet --verify "refs/tags/${tag}" >/dev/null ||
  git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null; then
  fail "tag ${tag} already exists; bump the version in package.json"
fi

pnpm install --frozen-lockfile
NODE_ENV=production pnpm run build

pack_dir=$(mktemp -d)
trap 'rm -rf "$pack_dir"' EXIT
npm pack --pack-destination "$pack_dir"
mv "$pack_dir"/lensdiff-*.tgz "$pack_dir/$ASSET"

gh release create "$tag" "$pack_dir/$ASSET" \
  --repo "$REPO" \
  --target "$head_sha" \
  --title "$tag" \
  --generate-notes \
  --latest

echo
echo "Released ${tag}. Install or update with:"
echo "  npm install -g https://github.com/${REPO}/releases/latest/download/${ASSET}"
echo "Or pin this version with:"
echo "  npm install -g https://github.com/${REPO}/releases/download/${tag}/${ASSET}"
