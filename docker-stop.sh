#!/bin/bash
# Written by Irmak Hakman in 2026.
# Copyright (c) 2026 Irmak Hakman
# SPDX-License-Identifier: BUSL-1.1  (see LICENSE)
# Docker development stop script

echo "🛑 Stopping Character Sheet Development Container..."

docker-compose down

echo "✅ Container stopped successfully!"
