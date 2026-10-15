#!/usr/bin/env bash
# Written by Irmak Hakman — 2026-10-15 18:28
# Copyright (c) 2026 Irmak Hakman
# SPDX-License-Identifier: BUSL-1.1  (see LICENSE)
#
# Makes the key every build of the app is signed with, once. Android only
# installs an update over the app if it carries the same key, so KEEP
# keystore/ and keystore.properties (both outside git) - copy them to the
# other dev machine and back them up. Refuses to replace an existing key.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f keystore.properties ] || [ -f keystore/rpg-console.jks ]; then
  echo "A signing key already exists (keystore/, keystore.properties). Not replacing it." >&2
  exit 1
fi

mkdir -p keystore
PW=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
keytool -genkeypair -noprompt \
  -keystore keystore/rpg-console.jks -storetype PKCS12 \
  -alias rpgconsole -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PW" -keypass "$PW" \
  -dname "CN=RPG Play console"

cat > keystore.properties <<EOF
storeFile=keystore/rpg-console.jks
storePassword=$PW
keyAlias=rpgconsole
keyPassword=$PW
EOF
chmod 600 keystore.properties keystore/rpg-console.jks
echo "Signing key made: keystore/rpg-console.jks (+ keystore.properties). Back both up."
