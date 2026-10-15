#!/usr/bin/env bash
# Written by Irmak Hakman — 2026-10-15 19:01
# Copyright (c) 2026 Irmak Hakman
# SPDX-License-Identifier: BUSL-1.1  (see LICENSE)
#
# Builds the console app into dist/rpg-console.apk, inside Docker.
#   ./make-keystore.sh   once, before the first build
#   ./build.sh           every build
# The first run builds the tools image (~2 GB download) and fills the Gradle
# cache in .gradle-home/; later builds take well under a minute.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE=rpg-console-android:1
if [ ! -f keystore.properties ]; then
  echo "No signing key yet: run ./make-keystore.sh first." >&2
  exit 1
fi
docker image inspect "$IMAGE" > /dev/null 2>&1 || docker build -t "$IMAGE" docker

mkdir -p .gradle-home .home
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -e HOME=/project/.home \
  -e GRADLE_USER_HOME=/project/.gradle-home \
  -v "$PWD":/project \
  "$IMAGE" gradle --no-daemon --quiet assembleRelease

mkdir -p dist
cp app/build/outputs/apk/release/app-release.apk dist/rpg-console.apk

# What the app checks for updates (Updater.kt): upload it next to the APK,
# both into public/downloads/ on the server.
CODE=$(sed -n 's/^ *versionCode = \([0-9]*\).*/\1/p' app/build.gradle.kts)
NAME=$(sed -n 's/^ *versionName = "\(.*\)".*/\1/p' app/build.gradle.kts)
SHA=$(sha256sum dist/rpg-console.apk | cut -d' ' -f1)
printf '{"versionCode":%s,"versionName":"%s","url":"/downloads/rpg-console.apk","sha256":"%s"}\n' \
  "$CODE" "$NAME" "$SHA" > dist/rpg-console.json
echo "Built dist/rpg-console.apk ($NAME, code $CODE) and dist/rpg-console.json"
