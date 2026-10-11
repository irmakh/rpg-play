// Written by Irmak Hakman — 2026-10-11 18:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Unit tests for lib/weather-words.js — a day's weather in words.
 *
 * describeWeather() is what players are told, so the one hard rule is that it
 * never carries a number; the rest checks that different weather really does
 * read differently. weatherDetail() is the DM's version and must carry them.
 */
import { describe, it, expect } from 'vitest';
import { describeWeather, weatherDetail } from '../../lib/weather-words.js';

const entry = (temp, wind = 'Normal', precip = 'None', level = 'normal') => ({
  sessionNormal: 60,
  temperature: { roll: 9, level, dice: level === 'normal' ? [] : [3, 5], value: temp },
  wind: { roll: 4, level: 'normal', value: wind },
  precipitation: { roll: 12, level: 'normal', value: precip },
});

describe('describeWeather', () => {
  it('never tells players a number', () => {
    for (const t of [-5, 20, 40, 55, 65, 80, 90, 110]) {
      for (const w of ['Normal', 'Light', 'Strong']) {
        for (const p of ['None', 'Light rain', 'Heavy rain', 'Light snow', 'Heavy snow']) {
          for (const l of ['normal', 'level1', 'level2']) {
            expect(describeWeather(entry(t, w, p, l))).not.toMatch(/\d/);
          }
        }
      }
    }
  });

  it('reads differently as the temperature changes', () => {
    const seen = new Set([5, 30, 40, 55, 65, 80, 90, 105].map(t => describeWeather(entry(t))));
    expect(seen.size).toBe(8);
    expect(describeWeather(entry(5))).toMatch(/bitterly cold/i);
    expect(describeWeather(entry(105))).toMatch(/scorching/i);
  });

  it('names a blizzard and a storm', () => {
    expect(describeWeather(entry(20, 'Strong', 'Heavy snow'))).toMatch(/blizzard/i);
    expect(describeWeather(entry(60, 'Strong', 'Heavy rain'))).toMatch(/storm/i);
    // Heavy snow without the wind is not one.
    expect(describeWeather(entry(20, 'Light', 'Heavy snow'))).not.toMatch(/blizzard/i);
  });

  it('mentions wind, rain and snow when there are any', () => {
    expect(describeWeather(entry(60, 'Strong'))).toMatch(/strong wind/i);
    expect(describeWeather(entry(60, 'Light'))).toMatch(/breeze/i);
    expect(describeWeather(entry(60, 'Normal', 'Light rain'))).toMatch(/light rain/i);
    expect(describeWeather(entry(25, 'Normal', 'Light snow'))).toMatch(/snow/i);
    expect(describeWeather(entry(60))).toMatch(/dry/i);
  });

  it('says when the day is colder or warmer than it has been', () => {
    expect(describeWeather(entry(50, 'Normal', 'None', 'level1'))).toMatch(/colder than it has been/);
    expect(describeWeather(entry(70, 'Normal', 'None', 'level2'))).toMatch(/warmer than it has been/);
    expect(describeWeather(entry(60))).not.toMatch(/than it has been/);
  });

  it('says what it means for travel', () => {
    expect(describeWeather(entry(60, 'Normal', 'Heavy rain'))).toMatch(/slow and tiring/);
    expect(describeWeather(entry(65))).toMatch(/good day to travel/i);
  });

  it('copes with an entry typed by hand, or none at all', () => {
    expect(describeWeather(null)).toBe('');
    expect(describeWeather({})).toBe('');
    const odd = { temperature: { value: 'warm-ish', level: 'normal' }, wind: { value: 'STRONG gusts' }, precipitation: { value: '' } };
    expect(describeWeather(odd)).toMatch(/strong wind/i);
  });
});

describe('weatherDetail', () => {
  it('gives the DM every value with its roll', () => {
    const d = weatherDetail(entry(52, 'Strong', 'Light rain', 'level1'));
    expect(d).toContain('Temperature 52°');
    expect(d).toContain('d20 9');
    expect(d).toContain('minus 3+5 = 8 from the normal 60°');
    expect(d).toContain('Wind Strong');
    expect(d).toContain('Precipitation Light rain');
  });

  it('says so when a value was set by hand', () => {
    const e = entry(60);
    e.temperature.roll = null; e.wind.roll = null; e.precipitation.roll = null;
    expect(weatherDetail(e).match(/set by hand/g)).toHaveLength(3);
  });
});
