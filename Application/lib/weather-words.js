// Written by Irmak Hakman — 2026-10-11 17:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * A day's weather in words.
 *
 * The weather log stores numbers and levels: a temperature, a wind strength, a
 * precipitation value, and the d20 behind each. Two readers want two different
 * things from that:
 *
 *   describeWeather(entry)  what the characters would notice stepping outside.
 *                           No numbers — this is what players are told.
 *   weatherDetail(entry)    the rolls and values, for the DM.
 *
 * Both are pure: the same entry always gives the same text, so the wording can
 * be recomputed whenever an entry is read and never has to be stored.
 */

// Temperatures are in the campaign's own degrees; the scale assumed here is the
// one the roller uses, where 32 is freezing and the default "normal" is 60.
const FREEZING = 32;

function tempBand(t) {
  if (t <= 10) return 'bitter';
  if (t <= FREEZING) return 'freezing';
  if (t <= 45) return 'cold';
  if (t <= 58) return 'cool';
  if (t <= 72) return 'mild';
  if (t <= 84) return 'warm';
  if (t <= 95) return 'hot';
  return 'scorching';
}

const TEMP_LINE = {
  bitter:    'A bitterly cold day; breath freezes in the air and metal bites bare skin.',
  freezing:  'A freezing day; puddles are iced over and the ground is hard underfoot.',
  cold:      'A cold day that calls for a cloak.',
  cool:      'A cool, fresh day.',
  mild:      'A mild, comfortable day.',
  warm:      'A warm day.',
  hot:       'A hot day; armour is a burden and waterskins empty quickly.',
  scorching: 'A scorching day; the air shimmers and shade is worth walking for.',
};

// Wind and precipitation are stored as words ("Strong", "Heavy snow"). A DM can
// type an entry by hand, so read them loosely.
function windOf(entry) {
  const v = String(entry?.wind?.value || '').toLowerCase();
  if (v.includes('strong')) return 'strong';
  if (v.includes('light')) return 'light';
  return 'calm';
}

function precipOf(entry) {
  const v = String(entry?.precipitation?.value || '').toLowerCase();
  const kind = v.includes('snow') ? 'snow' : v.includes('rain') ? 'rain' : '';
  if (!kind) return { kind: '', amount: '' };
  return { kind, amount: v.includes('heavy') ? 'heavy' : 'light' };
}

/** What the day feels like, in two or three sentences and no numbers. */
export function describeWeather(entry) {
  if (!entry || !entry.temperature) return '';
  const t = Number(entry.temperature.value);
  const band = tempBand(Number.isFinite(t) ? t : 60);
  const wind = windOf(entry);
  const { kind, amount } = precipOf(entry);
  const out = [TEMP_LINE[band]];

  // Colder or hotter than the season has been is worth saying on its own.
  if (entry.temperature.level === 'level1') out.push('It is noticeably colder than it has been.');
  if (entry.temperature.level === 'level2') out.push('It is noticeably warmer than it has been.');

  // Sky and wind together: the worst combinations get their own name.
  if (kind === 'snow' && amount === 'heavy' && wind === 'strong') {
    out.push('A blizzard is blowing: snow drives sideways, tracks vanish within minutes and it is hard to see more than a few paces.');
  } else if (kind === 'rain' && amount === 'heavy' && wind === 'strong') {
    out.push('A storm is raging: rain lashes down in sheets and the wind tears at cloaks and tents.');
  } else {
    if (kind === 'snow') {
      out.push(amount === 'heavy'
        ? 'Snow is falling thick and fast, burying the roads.'
        : 'A light snow drifts down and dusts the ground.');
    } else if (kind === 'rain') {
      out.push(amount === 'heavy'
        ? 'Rain is coming down hard; roads turn to mud and everything is soaked through.'
        : 'A light rain falls on and off.');
    } else {
      out.push(wind === 'calm' ? 'The sky is dry and the air is still.' : 'The sky is dry.');
    }
    if (wind === 'strong') out.push('A strong wind is blowing; loose things fly and voices do not carry far.');
    else if (wind === 'light') out.push('There is a light breeze.');
  }

  // What it means for anyone on the road.
  if (amount === 'heavy' || (wind === 'strong' && kind)) {
    out.push('Travel will be slow and tiring today.');
  } else if (band === 'bitter') {
    out.push('Nobody stays outdoors longer than they must.');
  } else if (band === 'scorching') {
    out.push('Long marches are best kept for the early morning.');
  } else if (!kind && wind !== 'strong' && (band === 'mild' || band === 'warm' || band === 'cool')) {
    out.push('A good day to travel.');
  }
  return out.join(' ');
}

const LEVEL_WORD = { normal: 'normal', level1: 'level 1', level2: 'level 2' };

/** The same day for the DM: every value with the roll that produced it. */
export function weatherDetail(entry) {
  if (!entry || !entry.temperature) return '';
  const roll = (c) => (c.roll == null ? 'set by hand' : `d20 ${c.roll}, ${LEVEL_WORD[c.level] || c.level}`);
  const t = entry.temperature;
  let temp = `Temperature ${t.value}° (${roll(t)}`;
  if (Array.isArray(t.dice) && t.dice.length) {
    const sum = t.dice.reduce((a, b) => a + b, 0);
    temp += `; ${t.level === 'level1' ? 'minus' : 'plus'} ${t.dice.join('+')} = ${sum} from the normal ${entry.sessionNormal}°`;
  }
  temp += ')';
  return [
    temp,
    `Wind ${entry.wind.value} (${roll(entry.wind)})`,
    `Precipitation ${entry.precipitation.value} (${roll(entry.precipitation)})`,
  ].join(' · ');
}
