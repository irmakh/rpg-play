// Written by Irmak Hakman — 2026-11-11 21:10
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The browser's spell code (public/js/lib/spell-data.js), for the server.
 *
 * One file decides what a spell is and how it may be cast; the Cast a Spell
 * pop-up and POST /api/characters/:id/cast must never disagree, so the server
 * runs that same file in a sandbox instead of keeping a copy of its rules.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ctx = vm.createContext({ JSON, Math, Date, String, Number, Array, Object, Set });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lib', 'spell-data.js'), 'utf8'), ctx,
  { filename: 'spell-data.js' });

export const SpellData = ctx;
