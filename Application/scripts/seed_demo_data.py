#!/usr/bin/env python3
# Written by Irmak Hakman — 2026-09-15 18:08
# Copyright (c) 2026 Irmak Hakman
# SPDX-License-Identifier: BUSL-1.1  (see LICENSE)
"""Seed a fresh demo campaign with meaningful sample data.

WHY THIS TALKS TO SQLITE DIRECTLY INSTEAD OF THE HTTP API:
Every write endpoint that matters here (create campaign, set a character's
password) is gated by a session token, and the only way to get one is
POST /api/auth/login or /api/auth/admin-login — both behind a hand-rendered,
deliberately OCR-hostile captcha (Application/lib/captcha.js). That's correct
security behavior for a real login, and there is no bypass for automation by
design. So this script writes straight to the SQLite files instead, using the
exact same schema (db/campaignsdb.js, db/localdb.js) and the exact same
scrypt password-hash format (lib/passwords.js) the app itself uses — a
password set here works in a normal browser login exactly as if the DM had
set it through the UI.

One exception: it DOES make one plain HTTP GET (no auth needed for that route)
to make the running app provision the new campaign's SQLite files, because
that provisioning logic (CREATE TABLE IF NOT EXISTS against the current
schema) lives in db/campaign-store.js and duplicating it here would drift out
of sync with real schema changes over time.

HOW TO RUN — this must run INSIDE the app container (it needs Python 3, the
exact bind-mounted SQLite files, and the app listening on localhost for the
provisioning step):

    docker compose exec app python3 scripts/seed_demo_data.py

The container must already be up (`docker-start.sh` / `docker compose up -d`).
"""
import hashlib
import json
import os
import secrets
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid
from getpass import getpass
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
CAMPAIGNS_DB = APP_DIR / 'campaigns.db'
CAMPAIGN_DATA_DIR = APP_DIR / 'data' / 'campaigns'
SERVER_URL = f"http://localhost:{os.environ.get('PORT', '3000')}"

SKILL_NAMES = [
    'Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History',
    'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception',
    'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival',
]
SKILL_AB = ['dex', 'wis', 'int', 'str', 'cha', 'int', 'wis', 'cha', 'int', 'wis',
            'int', 'wis', 'cha', 'cha', 'int', 'dex', 'dex', 'wis']
PERCEPTION_IDX = 11


# ── Node-compatible scrypt password hashing (lib/passwords.js) ───────────────
def hash_password(password: str) -> str:
    salt_hex = secrets.token_hex(16)
    key = hashlib.scrypt(password.encode('utf-8'), salt=salt_hex.encode('utf-8'),
                          n=16384, r=8, p=1, dklen=64)
    return f"{salt_hex}:{key.hex()}"


def gen_id() -> str:
    return str(uuid.uuid4())


def slugify(name: str) -> str:
    import re
    s = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return (s or 'campaign')[:60]


def unique_slug(conn, name: str) -> str:
    root = slugify(name)
    slug = root
    n = 2
    while conn.execute('SELECT 1 FROM campaigns WHERE slug = ?', (slug,)).fetchone():
        slug = f'{root}-{n}'
        n += 1
    return slug


def ability_mod(score: int) -> int:
    return (score - 10) // 2


def signed(n: int) -> str:
    return f'{n:+d}'


def prof_bonus(level: int) -> int:
    return 2 + (level - 1) // 4


# ── Character sheet builder ───────────────────────────────────────────────────
def build_character(*, name, species, klass, subclass, level, background, alignment,
                     abilities, save_profs, skill_profs, skill_expertise,
                     ac, hp, hit_die, speed, gold_gp, weapons, spells,
                     equipment, features, traits, languages, appearance, backstory,
                     armor_profs, weapon_profs, tool_profs,
                     spell_ability=None, slot1=0, slot2=0, password_hash=''):
    mods = {ab: ability_mod(score) for ab, score in abilities.items()}
    pb = prof_bonus(level)

    data = {
        'name': name, 'species': species, 'class': klass, 'subclass': subclass,
        'level': str(level), 'background': background, 'alignment': alignment,
        'profbonus': str(pb), 'xp': '0', 'session': '',
        'traits': traits, 'features': features, 'backstory': backstory,
        'appearance': appearance, 'languages': languages, 'equipment': equipment,
        'feats': '', 'conditions': '',
        'ac': str(ac), 'ac-bonus': '0',
        'hpmax': str(hp), 'hpcur': str(hp), 'hptemp': '0',
        'hd': f'{level}{hit_die}', 'hdspent': '0',
        'speed': str(speed), 'speed-base': str(speed), 'speed-bonus': '0',
        'init': signed(mods['dex']), 'init-bonus': '0',
        'prof-armor': armor_profs, 'prof-wpn': weapon_profs, 'prof-tools': tool_profs,
        'cp': '0', 'sp': '0', 'ep': '0', 'gp': str(gold_gp),
        'attune1': '', 'attune2': '', 'attune3': '',
        'df0': False, 'df1': False, 'df2': False, 'ds0': False, 'ds1': False, 'ds2': False,
        '_inspire': False,
        '_actions': json.dumps([]), '_actionIdCounter': 0,
        '_items': json.dumps([]), '_itemIdCounter': 0,
        '_rollHistory': json.dumps([]), '_loots': json.dumps([]),
    }
    for ab in ['str', 'dex', 'con', 'int', 'wis', 'cha']:
        data[ab] = str(abilities[ab])
        prof = ab in save_profs
        data[f'save-{ab}'] = signed(mods[ab] + (pb if prof else 0))
        data[f'save-prof-{ab}'] = prof

    for i in range(18):
        ab = SKILL_AB[i]
        prof = i in skill_profs
        exp = i in skill_expertise
        bonus = mods[ab] + (pb * 2 if exp else pb if prof else 0)
        data[f'sk-{i}'] = signed(bonus)
        data[f'sk-prof-{i}'] = prof
        data[f'sk-exp-{i}'] = exp

    perception_bonus = mods[SKILL_AB[PERCEPTION_IDX]] + \
        (pb * (2 if PERCEPTION_IDX in skill_expertise else 1) if PERCEPTION_IDX in skill_profs else 0)
    data['pp'] = str(10 + perception_bonus)
    data['pp2'] = ''

    if spell_ability:
        smod = mods[spell_ability]
        data['sp-ability'] = spell_ability
        data['sp-mod'] = signed(smod)
        data['sp-atk'] = signed(pb + smod)
        data['sp-dc'] = str(8 + pb + smod)
    else:
        data['sp-ability'] = ''
        data['sp-mod'] = ''
        data['sp-atk'] = ''
        data['sp-dc'] = ''
    for i in range(1, 7):
        data[f'slot-{i}-total'] = str(slot1 if i == 1 else slot2 if i == 2 else 0)
        data[f'slot-{i}-used'] = '0'

    data['_weapons'] = json.dumps([[w[0], w[1], w[2], w[3], None] for w in weapons])
    data['_spells'] = json.dumps([
        [s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], s[11], s[12], s[13], s[14]]
        for s in spells
    ])

    return {
        'id': gen_id(), 'name': name, 'dataJson': json.dumps(data),
        'charType': 'pc', 'passwordHash': password_hash,
    }


# ── Demo content ──────────────────────────────────────────────────────────────
def character_templates(player_password_hash):
    return [
        build_character(
            name='Brynn Ashwood', species='Human', klass='Fighter', subclass='Champion',
            level=3, background='Soldier', alignment='Lawful Good',
            abilities={'str': 16, 'dex': 14, 'con': 15, 'int': 10, 'wis': 12, 'cha': 8},
            save_profs={'str', 'con'},
            skill_profs={3, 7, 11, 17}, skill_expertise=set(),
            ac=16, hp=31, hit_die='d10', speed=30, gold_gp=15,
            weapons=[
                ('Longsword', signed(5), '1d8+3 slashing', 'versatile (1d10)'),
                ('Shortbow', signed(4), '1d6+2 piercing', 'range 80/320'),
            ],
            spells=[],
            equipment='Chain mail, shield, longsword, shortbow, 20 arrows, '
                      "explorer's pack, insignia of rank",
            features='Second Wind (bonus action, 1d10+3 HP, 1/rest). '
                     'Action Surge (1/rest). Improved Critical (19-20).',
            traits='Calm under pressure; keeps a battlefield journal.',
            languages='Common, Orc',
            appearance='Broad-shouldered, close-cropped grey hair, a long scar over one eyebrow.',
            backstory='A veteran sergeant of the border watch, now escorting the party '
                      'for reasons she keeps mostly to herself.',
            armor_profs='Light, medium, heavy armor, shields',
            weapon_profs='Simple weapons, martial weapons',
            tool_profs='None',
            password_hash=player_password_hash,
        ),
        build_character(
            name='Sylvaes Nightwhisper', species='Elf', klass='Wizard', subclass='School of Illusion',
            level=3, background='Sage', alignment='Neutral Good',
            abilities={'str': 8, 'dex': 14, 'con': 13, 'int': 17, 'wis': 12, 'cha': 10},
            save_profs={'int', 'wis'},
            skill_profs={2, 5, 6, 8}, skill_expertise=set(),
            ac=12, hp=18, hit_die='d6', speed=30, gold_gp=22,
            weapons=[('Dagger', signed(4), '1d4+2 piercing', 'finesse, thrown 20/60')],
            spells=[
                ['0', 'Fire Bolt', 'Action', '120 ft', False, False, 'Ranged spell attack, 2d10 fire', False, 'Evocation', True, False, False, '', 'action', 'Instantaneous'],
                ['0', 'Minor Illusion', 'Action', '30 ft', False, False, 'Sound or image', False, 'Illusion', False, True, True, '', 'action', '1 minute'],
                ['0', 'Prestidigitation', 'Action', '10 ft', False, False, 'Minor magical trick', False, 'Transmutation', True, True, False, '', 'action', 'Up to 1 hour'],
                ['1', 'Magic Missile', 'Action', '120 ft', False, False, '3 darts, 1d4+1 force each', True, 'Evocation', True, True, False, '', 'action', 'Instantaneous'],
                ['1', 'Shield', 'Reaction', 'Self', False, False, '+5 AC until next turn', True, 'Abjuration', True, True, False, '', 'reaction', '1 round'],
                ['1', 'Detect Magic', 'Action', 'Self', True, True, 'Sense magic within 30 ft', True, 'Divination', True, True, False, '', 'action', '10 minutes'],
                ['2', 'Mirror Image', 'Action', 'Self', False, False, '3 illusory duplicates', True, 'Illusion', True, True, False, '', 'action', '1 minute'],
                ['2', 'Misty Step', 'Bonus Action', 'Self', False, False, 'Teleport 30 ft', True, 'Conjuration', False, True, False, '', 'bonus', 'Instantaneous'],
            ],
            equipment="Component pouch, spellbook, scholar's pack, dagger, quarterstaff",
            features='Illusionist: Improved Minor Illusion. Arcane Recovery (1/day).',
            traits='Speaks in tangents about obscure magical theory; collects pressed flowers.',
            languages='Common, Elvish, Draconic, Sylvan',
            appearance='Silver hair kept in a long braid, ink-stained fingers, tired eyes.',
            backstory='Left the Academy of Candlekeep early after a research project went '
                      'somewhere the faculty found alarming.',
            armor_profs='None',
            weapon_profs='Daggers, darts, slings, quarterstaffs, light crossbows',
            tool_profs='None',
            spell_ability='int', slot1=4, slot2=2,
            password_hash=player_password_hash,
        ),
        build_character(
            name='Doran Emberforge', species='Dwarf', klass='Cleric', subclass='Life Domain',
            level=3, background='Acolyte', alignment='Lawful Good',
            abilities={'str': 14, 'dex': 10, 'con': 15, 'int': 10, 'wis': 16, 'cha': 12},
            save_profs={'wis', 'cha'},
            skill_profs={6, 9, 13, 14}, skill_expertise=set(),
            ac=16, hp=27, hit_die='d8', speed=25, gold_gp=12,
            weapons=[('Warhammer', signed(4), '1d8+2 bludgeoning', 'versatile (1d10)')],
            spells=[
                ['0', 'Sacred Flame', 'Action', '60 ft', False, False, 'DC13 Dex save, 1d8 radiant', False, 'Evocation', True, False, False, '', 'action', 'Instantaneous'],
                ['0', 'Guidance', 'Action', 'Touch', True, False, '+1d4 to one ability check', False, 'Divination', True, True, False, '', 'action', '1 minute'],
                ['0', 'Spare the Dying', 'Action', 'Touch', False, False, 'Stabilize a dying creature', False, 'Necromancy', True, True, False, '', 'action', 'Instantaneous'],
                ['1', 'Cure Wounds', 'Action', 'Touch', False, False, '1d8+3 HP healed', True, 'Evocation', True, False, False, '', 'action', 'Instantaneous'],
                ['1', 'Bless', 'Action', '30 ft', True, False, 'Up to 3 allies +1d4 attacks/saves', True, 'Enchantment', True, True, True, 'sprinkle of holy water', 'action', '1 minute'],
                ['1', 'Healing Word', 'Bonus Action', '60 ft', False, False, '1d4+3 HP healed', True, 'Evocation', True, False, False, '', 'bonus', 'Instantaneous'],
                ['2', 'Lesser Restoration', 'Action', 'Touch', False, False, 'End one disease/condition', True, 'Abjuration', True, False, False, '', 'action', 'Instantaneous'],
                ['2', 'Spiritual Weapon', 'Bonus Action', '60 ft', False, False, '1d8+3 force, movable', True, 'Evocation', True, True, False, '', 'bonus', '1 minute'],
            ],
            equipment="Scale mail, shield, warhammer, holy symbol, priest's pack",
            features='Disciple of Life (healing spells restore extra HP). Channel Divinity: '
                     'Preserve Life (1/rest).',
            traits='Unfailingly polite, even to hostile monsters; hums old hymns while marching.',
            languages='Common, Dwarvish',
            appearance='Stocky, red beard in two braids, wears a well-worn holy symbol of silver.',
            backstory='Sent out from the mountain temple to see more of the world before '
                      'taking his final vows.',
            armor_profs='Light, medium, heavy armor, shields',
            weapon_profs='Simple weapons',
            tool_profs="Smith's tools",
            spell_ability='wis', slot1=4, slot2=2,
            password_hash=player_password_hash,
        ),
        build_character(
            name='Piper Lightfingers', species='Halfling', klass='Rogue', subclass='Thief',
            level=3, background='Criminal', alignment='Chaotic Good',
            abilities={'str': 8, 'dex': 17, 'con': 13, 'int': 12, 'wis': 10, 'cha': 14},
            save_profs={'dex', 'int'},
            skill_profs={0, 4, 8, 11, 15, 16}, skill_expertise={15, 16},
            ac=15, hp=21, hit_die='d8', speed=25, gold_gp=30,
            weapons=[
                ('Shortsword', signed(5), '1d6+3 piercing', 'finesse'),
                ('Shortbow', signed(5), '1d6+3 piercing', 'range 80/320'),
            ],
            spells=[],
            equipment="Studded leather armor, two shortswords, shortbow, 20 arrows, "
                      "thieves' tools, burglar's pack, hooded cloak",
            features="Sneak Attack (2d6). Cunning Action. Thieves' Cant. Fast Hands.",
            traits='Never sits with her back to a door; pockets things without quite meaning to.',
            languages="Common, Halfling, Thieves' Cant",
            appearance='Small, quick, a gap-toothed grin, more pockets than clothing should allow.',
            backstory="Grew up running messages for a guild she'd rather forget; the party is "
                      'the first crew she has trusted since.',
            armor_profs='Light armor',
            weapon_profs='Simple weapons, hand crossbows, longswords, rapiers, shortswords',
            tool_profs="Thieves' tools, one type of gaming set",
            password_hash=player_password_hash,
        ),
    ]


MONSTERS = [
    {
        'name': 'Goblin', 'cr': '1/4',
        'data': {
            'name': 'Goblin', 'size': ['S'], 'type': 'humanoid (goblinoid)', 'alignment': ['N', 'E'],
            'ac': [{'ac': 15, 'from': ['leather armor, shield']}], 'hp': {'average': 7, 'formula': '2d6'},
            'speed': {'walk': 30}, 'cr': '1/4',
            'str': 8, 'dex': 14, 'con': 10, 'int': 10, 'wis': 8, 'cha': 8,
            'skill': {'stealth': '+6'}, 'senses': ['darkvision 60 ft.'], 'passive': 9,
            'languages': ['Common', 'Goblin'],
            'trait': [{'name': 'Nimble Escape', 'entries': [
                'The goblin can take the Disengage or Hide action as a bonus action on each of its turns.']}],
            'action': [
                {'name': 'Scimitar', 'entries': ['Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 1d6+2 slashing damage.']},
                {'name': 'Shortbow', 'entries': ['Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 1d6+2 piercing damage.']},
            ],
        },
    },
    {
        'name': 'Orc', 'cr': '1/2',
        'data': {
            'name': 'Orc', 'size': ['M'], 'type': 'humanoid (orc)', 'alignment': ['C', 'E'],
            'ac': [{'ac': 13, 'from': ['hide armor']}], 'hp': {'average': 15, 'formula': '2d8+6'},
            'speed': {'walk': 30}, 'cr': '1/2',
            'str': 16, 'dex': 12, 'con': 16, 'int': 7, 'wis': 11, 'cha': 10,
            'skill': {'intimidation': '+2'}, 'senses': ['darkvision 60 ft.'], 'passive': 10,
            'languages': ['Common', 'Orc'],
            'trait': [{'name': 'Aggressive', 'entries': [
                'As a bonus action, the orc can move up to its speed toward a hostile creature it can see.']}],
            'action': [
                {'name': 'Greataxe', 'entries': ['Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 1d12+3 slashing damage.']},
                {'name': 'Javelin', 'entries': ['Melee or Ranged Weapon Attack: +5 to hit, reach 5 ft. or range 30/120 ft. Hit: 1d6+3 piercing damage.']},
            ],
        },
    },
    {
        'name': 'Skeleton', 'cr': '1/4',
        'data': {
            'name': 'Skeleton', 'size': ['M'], 'type': 'undead', 'alignment': ['L', 'E'],
            'ac': [{'ac': 13, 'from': ['armor scraps']}], 'hp': {'average': 13, 'formula': '2d8+4'},
            'speed': {'walk': 30}, 'cr': '1/4',
            'str': 10, 'dex': 14, 'con': 15, 'int': 6, 'wis': 8, 'cha': 5,
            'vulnerable': ['bludgeoning'], 'immune': ['poison'],
            'conditionImmune': ['exhaustion', 'poisoned'],
            'senses': ['darkvision 60 ft.'], 'passive': 9,
            'languages': ['understands the languages it knew in life but can\'t speak'],
            'action': [
                {'name': 'Shortsword', 'entries': ['Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 1d6+2 piercing damage.']},
                {'name': 'Shortbow', 'entries': ['Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 1d6+2 piercing damage.']},
            ],
        },
    },
    {
        'name': 'Giant Spider', 'cr': '1',
        'data': {
            'name': 'Giant Spider', 'size': ['L'], 'type': 'beast', 'alignment': ['U'],
            'ac': [14], 'hp': {'average': 26, 'formula': '4d10+4'},
            'speed': {'walk': 30, 'climb': 30}, 'cr': '1',
            'str': 14, 'dex': 16, 'con': 12, 'int': 2, 'wis': 11, 'cha': 4,
            'skill': {'stealth': '+7'}, 'senses': ['darkvision 60 ft.'], 'passive': 10,
            'languages': [],
            'trait': [
                {'name': 'Spider Climb', 'entries': ['The spider can climb difficult surfaces, including upside down on ceilings, without needing to make an ability check.']},
                {'name': 'Web Sense', 'entries': ['While in contact with a web, the spider knows the exact location of any other creature in contact with the same web.']},
                {'name': 'Web Walker', 'entries': ['The spider ignores movement restrictions caused by webbing.']},
            ],
            'action': [
                {'name': 'Bite', 'entries': ['Melee Weapon Attack: +5 to hit, reach 5 ft., one creature. Hit: 1d8+3 piercing damage plus 2d8 poison damage (DC 11 Constitution save halves).']},
                {'name': 'Web (Recharge 5-6)', 'entries': ['Ranged Weapon Attack: +5 to hit, range 30/60 ft., one creature. Hit: the target is restrained by webbing (DC 13 Strength save to escape).']},
            ],
        },
    },
    {
        'name': 'Owlbear', 'cr': '3',
        'data': {
            'name': 'Owlbear', 'size': ['L'], 'type': 'monstrosity', 'alignment': ['U'],
            'ac': [13], 'hp': {'average': 59, 'formula': '7d10+21'},
            'speed': {'walk': 40}, 'cr': '3',
            'str': 20, 'dex': 12, 'con': 17, 'int': 3, 'wis': 12, 'cha': 7,
            'skill': {'perception': '+3'}, 'senses': ['darkvision 60 ft.'], 'passive': 13,
            'languages': [],
            'trait': [{'name': 'Keen Sight and Smell', 'entries': [
                'The owlbear has advantage on Wisdom (Perception) checks that rely on sight or smell.']}],
            'action': [
                {'name': 'Multiattack', 'entries': ['The owlbear makes two attacks: one with its beak and one with its claws.']},
                {'name': 'Beak', 'entries': ['Melee Weapon Attack: +7 to hit, reach 5 ft., one creature. Hit: 1d10+5 piercing damage.']},
                {'name': 'Claws', 'entries': ['Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 2d8+5 slashing damage.']},
            ],
        },
    },
]

TREASURY_ITEMS = [
    dict(name='Potion of Healing', tag='consumable', mode='loot', itemType='potion',
         description='A red liquid that glimmers when agitated. Restores 2d4+2 hit points when consumed.',
         descVisible=1, quantity=3, valueCp=5000),
    dict(name='Longsword +1', tag='weapon', mode='shop', itemType='weapon',
         description='A finely balanced longsword humming faintly with latent magic.',
         descVisible=1, quantity=1, valueCp=100000,
         weaponAtk='+1', weaponDmg='1d8+1 slashing'),
    dict(name='Cloak of Protection', tag='wondrous', mode='shop', itemType='wondrous',
         description='A subtly-warded cloak. You gain a +1 bonus to AC and saving throws while wearing it.',
         descVisible=1, quantity=1, valueCp=350000, requiresAttunement=1, acBonus=1),
    dict(name='Bag of Holding', tag='wondrous', mode='shop', itemType='wondrous',
         description='A nondescript sack that opens into an extradimensional space, holding up to 500 lb '
                      'without adding to your carried weight.',
         descVisible=1, quantity=1, valueCp=400000),
    dict(name='Chain Mail', tag='armor', mode='shop', itemType='armor', armorType='heavy',
         description='Interlocking metal rings. AC 16, requires 13 Strength, disadvantage on Stealth.',
         descVisible=1, quantity=2, valueCp=7500, acBase=16),
    dict(name='Rations (10 days)', tag='gear', mode='loot', itemType='other',
         description='Dried meat, hard biscuit, and fruit — enough for ten days on the road.',
         descVisible=1, quantity=10, valueCp=500),
    dict(name="Healer's Kit", tag='gear', mode='shop', itemType='other',
         description='Bandages, salves and splints. Ten uses before it runs out.',
         descVisible=1, quantity=2, valueCp=500),
    dict(name='Dull Iron Ring', tag='wondrous', mode='hidden', itemType='wondrous',
         description='A plain iron band, unremarkable but for the faint warmth it holds.',
         descVisible=0, quantity=1, valueCp=0),
]


# ── DB writes ──────────────────────────────────────────────────────────────────
def create_campaign(name: str, dm_password: str) -> dict:
    conn = sqlite3.connect(CAMPAIGNS_DB)
    try:
        campaign_id = gen_id()
        slug = unique_slug(conn, name)
        conn.execute(
            'INSERT INTO campaigns (id, name, slug, description, dmPasswordHash, isActive) '
            'VALUES (?, ?, ?, ?, ?, 1)',
            (campaign_id, name, slug,
             'Demo campaign seeded by scripts/seed_demo_data.py — feel free to change or delete anything.',
             hash_password(dm_password)),
        )
        conn.commit()
        return {'id': campaign_id, 'slug': slug}
    finally:
        conn.close()


def trigger_provisioning(campaign_id: str):
    req = urllib.request.Request(f'{SERVER_URL}/api/characters', headers={'X-Campaign-Id': campaign_id})
    try:
        urllib.request.urlopen(req, timeout=10).read()
    except urllib.error.URLError as e:
        sys.exit(f"\nCouldn't reach the app at {SERVER_URL} ({e}).\n"
                  "Make sure the container is up first: docker-compose up -d (or ./docker-start.sh)")

    local_db = CAMPAIGN_DATA_DIR / campaign_id / 'localdb.db'
    for _ in range(20):
        if local_db.exists():
            return local_db
        time.sleep(0.25)
    sys.exit(f'Timed out waiting for {local_db} to be created.')


def seed_content(local_db_path: Path, characters: list):
    conn = sqlite3.connect(local_db_path)
    try:
        for char in characters:
            conn.execute(
                'INSERT INTO characters (id, name, dataJson, charType, passwordHash) VALUES (?, ?, ?, ?, ?)',
                (char['id'], char['name'], char['dataJson'], char['charType'], char['passwordHash']),
            )
        for mon in MONSTERS:
            conn.execute(
                'INSERT INTO monsters (id, name, cr, dataJson) VALUES (?, ?, ?, ?)',
                (gen_id(), mon['name'], mon['cr'], json.dumps(mon['data'])),
            )
        for item in TREASURY_ITEMS:
            cols = ['id', 'name'] + [k for k in item if k != 'name']
            values = [gen_id(), item['name']] + [item[k] for k in item if k != 'name']
            placeholders = ', '.join('?' for _ in cols)
            conn.execute(f'INSERT INTO treasury_items ({", ".join(cols)}) VALUES ({placeholders})', values)
        conn.commit()
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


def main():
    print('=== RPG Play demo data seeder ===\n')
    if not CAMPAIGNS_DB.exists():
        sys.exit(f'{CAMPAIGNS_DB} not found — run this inside the app container '
                  '(docker compose exec app python3 scripts/seed_demo_data.py)')

    name = input('Demo campaign name: ').strip()
    while not name:
        name = input('Demo campaign name (required): ').strip()
    dm_password = prompt_password('DM password')
    player_password = prompt_password('Player password (used for all demo characters)')

    print('\nCreating campaign...')
    campaign = create_campaign(name, dm_password)
    print(f"  Created \"{name}\" (slug: {campaign['slug']})")

    print('Provisioning campaign database (via the running app)...')
    local_db_path = trigger_provisioning(campaign['id'])

    print('Seeding characters, monsters and treasury items...')
    characters = character_templates(hash_password(player_password))
    seed_content(local_db_path, characters)

    print(f"""
=== Done ===
Campaign:  {name}
Open at:   {SERVER_URL}/  (pick "{name}" from the campaign list)
DM login:  password you just set
Players:   {len(characters)} characters, all sharing the player password you set
           ({', '.join(c['name'] for c in characters)})
Monsters:  {len(MONSTERS)} ({', '.join(m['name'] for m in MONSTERS)})
Treasury:  {len(TREASURY_ITEMS)} items (mix of shop, free loot, and one DM-hidden item)

Note: no portrait/map images were generated — sheets and stat blocks use the
app's normal blank-portrait placeholder. Add real images through the UI if
you want them.
""")


if __name__ == '__main__':
    main()
