#!/usr/bin/env python3
# Written by Irmak Hakman — 2026-10-11 16:40
# Copyright (c) 2026 Irmak Hakman
# SPDX-License-Identifier: BUSL-1.1  (see LICENSE)
"""Install the demo campaign, "Shadows over Emberfall", into a development install.

The whole campaign comes from one file, demo_campaign.zip:

    campaign.json   its row in the campaign registry (name, description, cover)
    data/*.db       its four databases (localdb, media, stories, aiDM)
    uploads/        every file it refers to — portraits, maps, handout and
                    treasury images, waiting screens, the music

THE ZIP IS NOT IN GIT, and must never be: its pictures and music may be
copyrighted. It is passed on by hand. Put it beside this script as
scripts/demo_campaign.zip before running, or point --zip at it (a path the
container can see, so somewhere under Application/). Without it nothing is
installed.

It fills every screen: 5 player characters, 11 monsters, the table with a map,
tokens and a fight in progress, 4 prepared maps, treasury with a ledger and
requests, handouts, calendar events, weather, playlists with real tracks, chat
and notifications.

EVERY RUN PUTS THE CAMPAIGN BACK AS IT IS IN THE ZIP. The campaign keeps its
fixed id, so a second run overwrites the demo campaign on this machine —
databases, files and both passwords — and anything changed in it since the
last run is lost. Other campaigns are never touched.

WHY THIS TALKS TO SQLITE DIRECTLY INSTEAD OF THE HTTP API:
Creating a campaign and setting passwords need a DM or admin session, and the
only way to get one is a login behind a hand-rendered, deliberately
OCR-hostile captcha (lib/captcha.js). There is no bypass for automation, by
design. So this script writes the files itself: the registry row in
campaigns.db with the same scrypt password format as lib/passwords.js, and the
campaign databases through SQLite's own backup call, which is safe even while
the app has them open.

HOW TO RUN — inside the app container, then restart the app:

    docker compose exec -T app python3 scripts/seed_demo_data.py --defaults
    docker compose restart app

The restart matters: the app upgrades a campaign's tables when it first opens
them, and it will not look again at databases it already had open.

--defaults asks nothing and uses the passwords in DEFAULT_* below. Without it
the script asks for whichever of --dm-password / --player-password is missing.

DEVELOPMENT MACHINES ONLY: the default passwords are written in this file.
"""
import argparse
import hashlib
import json
import secrets
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from getpass import getpass
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
CAMPAIGNS_DB = APP_DIR / 'campaigns.db'
CAMPAIGN_DATA_DIR = APP_DIR / 'data' / 'campaigns'
UPLOADS_DIR = APP_DIR / 'public' / 'uploads'
CAMPAIGN_ZIP = Path(__file__).resolve().parent / 'demo_campaign.zip'
DB_FILES = ['localdb.db', 'media.db', 'stories.db', 'aiDM.db']

# What --defaults uses. Known to anyone who can read this file: local use only.
DEFAULT_DM_PASSWORD = 'demo-dm'
DEFAULT_PLAYER_PASSWORD = 'demo-player'


# ── Node-compatible scrypt password hashing (lib/passwords.js) ───────────────
def hash_password(password: str) -> str:
    salt_hex = secrets.token_hex(16)
    key = hashlib.scrypt(password.encode('utf-8'), salt=salt_hex.encode('utf-8'),
                          n=16384, r=8, p=1, dklen=64)
    return f"{salt_hex}:{key.hex()}"


# ── Install steps ─────────────────────────────────────────────────────────────
def open_zip(path: Path) -> zipfile.ZipFile:
    """The campaign zip, after checking it is there, complete and safe to unpack."""
    if not path.is_file():
        sys.exit(f'{path} is not there, so nothing was installed.\n'
                 'The demo campaign is not in git: get demo_campaign.zip, put it beside this '
                 'script (Application/scripts/) and run this again.')
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    missing = [n for n in ['campaign.json'] + [f'data/{f}' for f in DB_FILES] if n not in names]
    if missing:
        sys.exit(f'{path.name} is not a complete demo campaign. Missing: ' + ', '.join(missing))
    # The zip arrives by hand from somewhere else: nothing in it may land
    # outside the folders it is unpacked into.
    for name in names:
        if Path(name).is_absolute() or '..' in Path(name).parts or '\\' in name:
            sys.exit(f'{path.name} holds a file with an unsafe path ({name!r}) — not installing it.')
    return z


def write_registry_row(meta: dict, dm_password: str) -> bool:
    """Adds the campaign to campaigns.db, or resets the one already there.
    Returns True when it was already there."""
    conn = sqlite3.connect(CAMPAIGNS_DB)
    try:
        existed = conn.execute('SELECT 1 FROM campaigns WHERE id = ?', (meta['id'],)).fetchone() is not None
        # A slug is unique; step aside if another campaign already took this one.
        slug, n = meta['slug'], 2
        while conn.execute('SELECT 1 FROM campaigns WHERE slug = ? AND id <> ?', (slug, meta['id'])).fetchone():
            slug = f"{meta['slug']}-{n}"
            n += 1
        fields = (meta['name'], slug, meta['description'], hash_password(dm_password),
                  meta['coverUrl'], meta['coverThumb'], meta['coverMedium'])
        if existed:
            conn.execute(
                'UPDATE campaigns SET name = ?, slug = ?, description = ?, dmPasswordHash = ?, '
                'coverUrl = ?, coverThumb = ?, coverMedium = ?, isActive = 1 WHERE id = ?',
                fields + (meta['id'],),
            )
        else:
            created = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
            conn.execute(
                'INSERT INTO campaigns (id, name, slug, description, dmPasswordHash, coverUrl, '
                'coverThumb, coverMedium, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
                (meta['id'],) + fields + (created,),
            )
        conn.commit()
        return existed
    finally:
        conn.close()


def restore_databases(z: zipfile.ZipFile, campaign_id: str):
    """Copies each database in the zip over the campaign's own. sqlite's backup
    takes the same locks as any other writer, so this is safe while the app
    has the file open — unlike replacing the file underneath it."""
    target_dir = CAMPAIGN_DATA_DIR / campaign_id
    target_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:      # sqlite cannot read from inside a zip
        for name in DB_FILES:
            unpacked = Path(tmp) / name
            unpacked.write_bytes(z.read(f'data/{name}'))
            source = sqlite3.connect(unpacked)
            target = sqlite3.connect(target_dir / name, timeout=30)
            try:
                source.backup(target)
            finally:
                target.close()
                source.close()


def set_player_password(campaign_id: str, player_password: str) -> list:
    """The snapshot carries no passwords. Gives every character the same one
    and returns their names."""
    conn = sqlite3.connect(CAMPAIGN_DATA_DIR / campaign_id / 'localdb.db', timeout=30)
    try:
        rows = conn.execute('SELECT id, name FROM characters ORDER BY name').fetchall()
        for char_id, _ in rows:
            # A hash each, as the app would make them: the salt is random.
            conn.execute('UPDATE characters SET passwordHash = ? WHERE id = ?',
                         (hash_password(player_password), char_id))
        conn.commit()
        return [name for _, name in rows]
    finally:
        conn.close()


def restore_uploads(z: zipfile.ZipFile, meta: dict) -> int:
    """Replaces public/uploads/<campaign id>/ with the zip's uploads/ folder."""
    target = UPLOADS_DIR / meta['id']
    members = [m for m in z.infolist() if m.filename.startswith('uploads/') and not m.is_dir()]
    if target.exists():
        shutil.rmtree(target)
    for m in members:
        dest = target / m.filename[len('uploads/'):]
        dest.parent.mkdir(parents=True, exist_ok=True)
        with z.open(m) as src, open(dest, 'wb') as out:
            shutil.copyfileobj(src, out)
    # Files the campaign uses under two names (the map on the table is one of
    # the prepared maps) are in the zip once.
    for copy in meta.get('copies', []):
        if (target / copy['from']).is_file():
            shutil.copyfile(target / copy['from'], target / copy['to'])
    return len(members)


def count_rows(campaign_id: str) -> dict:
    conn = sqlite3.connect(CAMPAIGN_DATA_DIR / campaign_id / 'localdb.db', timeout=30)
    try:
        tables = ['monsters', 'table_tokens', 'prepared_maps', 'treasury_items', 'handouts',
                  'calendar_events', 'weather_log', 'sound_files', 'playlists', 'chat_log']
        return {t: conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in tables}
    finally:
        conn.close()


# ── CLI ────────────────────────────────────────────────────────────────────────
def prompt_password(label: str, minlen: int = 3) -> str:
    while True:
        pw = getpass(f'{label}: ')
        if len(pw) < minlen:
            print(f'  Must be at least {minlen} characters.')
            continue
        confirm = getpass(f'{label} (again): ')
        if pw != confirm:
            print("  Didn't match, try again.")
            continue
        return pw


def parse_args():
    p = argparse.ArgumentParser(description='Install the demo campaign into a local development install.')
    p.add_argument('--defaults', action='store_true',
                   help='ask nothing; use the built-in passwords for any not given')
    p.add_argument('--dm-password', help='DM password')
    p.add_argument('--player-password', help='password shared by the demo characters')
    p.add_argument('--zip', type=Path, default=CAMPAIGN_ZIP,
                   help='the demo campaign zip (default: demo_campaign.zip beside this script)')
    args = p.parse_args()
    for flag, value in (('--dm-password', args.dm_password), ('--player-password', args.player_password)):
        if value is not None and len(value) < 3:
            p.error(f'{flag} must be at least 3 characters')
    return args


def main():
    args = parse_args()
    print('=== RPG Play demo campaign ===\n')
    if not CAMPAIGNS_DB.exists():
        sys.exit(f'{CAMPAIGNS_DB} not found — start the app once so it creates it, then run this '
                  'inside the app container '
                  '(docker compose exec -T app python3 scripts/seed_demo_data.py --defaults)')
    z = open_zip(args.zip)
    meta = json.loads(z.read('campaign.json').decode('utf-8'))

    dm_password, player_password = args.dm_password, args.player_password
    if args.defaults:
        dm_password = dm_password or DEFAULT_DM_PASSWORD
        player_password = player_password or DEFAULT_PLAYER_PASSWORD
    elif None in (dm_password, player_password) and not sys.stdin.isatty():
        sys.exit('Nothing to type into here. Pass --defaults, or give --dm-password '
                 'and --player-password.')
    if dm_password is None:
        dm_password = prompt_password('DM password')
    if player_password is None:
        player_password = prompt_password('Player password (used for all demo characters)')

    existed = write_registry_row(meta, dm_password)
    print(f"{'Putting back' if existed else 'Adding'} \"{meta['name']}\"...")
    print('  databases')
    restore_databases(z, meta['id'])
    characters = set_player_password(meta['id'], player_password)
    print('  files')
    files = restore_uploads(z, meta)
    z.close()
    n = count_rows(meta['id'])

    def shown(value, default):
        return f'"{value}"' if value == default else 'the one you chose'

    print(f"""
=== Done ===
Campaign:  {meta['name']}{'  (the copy that was here has been replaced)' if existed else ''}
DM login:  password {shown(dm_password, DEFAULT_DM_PASSWORD)}
Players:   {len(characters)} characters, all with password {shown(player_password, DEFAULT_PLAYER_PASSWORD)}
           ({', '.join(characters)})
Contents:  {n['monsters']} monsters, {n['table_tokens']} tokens on the table, {n['prepared_maps']} prepared maps,
           {n['treasury_items']} treasury items, {n['handouts']} handouts, {n['calendar_events']} calendar events,
           {n['weather_log']} days of weather, {n['sound_files']} tracks in {n['playlists']} playlists, {n['chat_log']} chat lines
Files:     {files} (portraits, maps, handout and treasury images, music)

NOW RESTART THE APP so it opens the restored databases afresh:
    docker compose restart app
""")


if __name__ == '__main__':
    main()
