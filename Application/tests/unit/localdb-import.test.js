/**
 * Tests for the selective import functions in db/localdb.js that back the
 * "restore one section" endpoints.
 *
 * These run against a REAL localdb opened on ':memory:', not a hand-written
 * stand-in, because the bugs they cover were all schema drift: a hand-written
 * INSERT that stopped listing every column the table had grown.
 *
 *   · importMaps dropped preparedTokens, so restoring a maps backup silently
 *     lost every token placed on every prepared map.
 *   · waiting screens, handouts and the Events screen had no import path at all
 *     — nothing backed them up, so nothing could restore them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openCampaignDb } from '../../db/localdb.js';

let ldb;
beforeEach(() => { ldb = openCampaignDb(':memory:'); });

// ── Maps ──────────────────────────────────────────────────────────────────────
describe('importMaps', () => {
  const tokens = [
    { id: 't1', name: 'Guard', x: 10, y: 20, color: '#c8a04a', visible: true },
    { id: 't2', name: 'Archer', x: 30, y: 40, color: '#3DD68C', visible: false },
  ];
  const map = (over = {}) => ({
    id: 'm1', name: 'Cavern', cellSize: 60, offsetX: 5, offsetY: 7,
    mapWidth: 1024, mapHeight: 768,
    fogRegions: [{ x: 0, y: 0, w: 50, h: 50 }],
    hiddenItems: [{ x: 1, y: 2, name: 'Chest' }],
    preparedTokens: tokens,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it('restores prepared tokens', () => {
    ldb.importMaps([map()]);
    expect(JSON.parse(ldb.getPreparedMap('m1').preparedTokens)).toHaveLength(2);
  });

  it('preserves each token\'s fields', () => {
    ldb.importMaps([map()]);
    const [a, b] = JSON.parse(ldb.getPreparedMap('m1').preparedTokens);
    expect(a).toMatchObject({ name: 'Guard', x: 10, visible: true });
    expect(b).toMatchObject({ name: 'Archer', visible: false });
  });

  it('restores fog and hidden items alongside them', () => {
    ldb.importMaps([map()]);
    const m = ldb.getPreparedMap('m1');
    expect(JSON.parse(m.fogRegions)).toHaveLength(1);
    expect(JSON.parse(m.hiddenItems)).toHaveLength(1);
  });

  it('restores the grid settings', () => {
    ldb.importMaps([map()]);
    expect(ldb.getPreparedMap('m1')).toMatchObject({ name: 'Cavern', cellSize: 60, offsetX: 5, offsetY: 7 });
  });

  it('accepts tokens already serialised as a string', () => {
    ldb.importMaps([map({ preparedTokens: JSON.stringify(tokens) })]);
    expect(JSON.parse(ldb.getPreparedMap('m1').preparedTokens)).toHaveLength(2);
  });

  it('defaults to no tokens when the backup predates them', () => {
    const { preparedTokens, ...noTokens } = map();
    ldb.importMaps([noTokens]);
    expect(JSON.parse(ldb.getPreparedMap('m1').preparedTokens)).toEqual([]);
  });

  it('keeps an existing map under an _old name rather than overwriting', () => {
    ldb.importMaps([map({ name: 'Original' })]);
    ldb.importMaps([map({ name: 'Restored' })]);
    const names = ldb.listPreparedMaps().map(m => m.name).sort();
    expect(names).toEqual(['Original _old', 'Restored']);
  });

  it('tolerates an empty list', () => {
    expect(() => ldb.importMaps([])).not.toThrow();
    expect(() => ldb.importMaps(undefined)).not.toThrow();
  });
});

// ── Waiting screens ───────────────────────────────────────────────────────────
describe('importWaitingScreens', () => {
  const screen = (over = {}) => ({
    id: 'w1', name: 'Break', caption: 'back soon',
    imageUrl: '/uploads/waiting/w1.jpg', imageThumb: '/uploads/waiting/w1_thumb.jpg',
    imageMedium: '/uploads/waiting/w1_med.jpg', createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it('restores a screen with its caption and image', () => {
    ldb.importWaitingScreens([screen()]);
    expect(ldb.getWaitingScreen('w1')).toMatchObject({
      name: 'Break', caption: 'back soon', imageUrl: '/uploads/waiting/w1.jpg',
    });
  });

  it('restores the derived image sizes', () => {
    ldb.importWaitingScreens([screen()]);
    const w = ldb.getWaitingScreen('w1');
    expect(w.imageThumb).toBe('/uploads/waiting/w1_thumb.jpg');
    expect(w.imageMedium).toBe('/uploads/waiting/w1_med.jpg');
  });

  it('restores several screens', () => {
    ldb.importWaitingScreens([screen(), screen({ id: 'w2', name: 'Intermission' })]);
    expect(ldb.listWaitingScreens()).toHaveLength(2);
  });

  it('keeps an existing screen under an _old name', () => {
    ldb.importWaitingScreens([screen({ name: 'Original' })]);
    ldb.importWaitingScreens([screen({ name: 'Restored' })]);
    expect(ldb.listWaitingScreens().map(w => w.name).sort()).toEqual(['Original _old', 'Restored']);
  });

  it('skips rows with no id', () => {
    ldb.importWaitingScreens([{ name: 'nope' }, screen()]);
    expect(ldb.listWaitingScreens()).toHaveLength(1);
  });

  it('tolerates empty input', () => {
    expect(() => ldb.importWaitingScreens()).not.toThrow();
  });
});

// ── Handouts ──────────────────────────────────────────────────────────────────
describe('exportHandouts / importHandouts', () => {
  const handout = (over = {}) => ({
    id: 'h1', title: 'The Letter', tag: 'act1', promptText: 'A sealed letter.',
    successText: 'You read it.', successImageUrl: '/uploads/handouts/h1s.jpg',
    failText: 'Smudged.', failImageUrl: '/uploads/handouts/h1f.jpg',
    checkSkill: 5, checkDc: 14, createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
  const recipient = (over = {}) => ({
    id: 'r1', handoutId: 'h1', charId: 'c1', rollTotal: 17,
    rollDetail: '1d20(12)+5', rolledAt: '2026-01-02T00:00:00.000Z',
    outcome: 'success', seenAt: '', createdAt: '2026-01-02T00:00:00.000Z',
    ...over,
  });

  it('restores a handout with both reveals', () => {
    ldb.importHandouts({ handouts: [handout()] });
    expect(ldb.getHandout('h1')).toMatchObject({
      title: 'The Letter', successText: 'You read it.', failText: 'Smudged.',
      successImageUrl: '/uploads/handouts/h1s.jpg', failImageUrl: '/uploads/handouts/h1f.jpg',
    });
  });

  it('restores the skill check', () => {
    ldb.importHandouts({ handouts: [handout()] });
    expect(ldb.getHandout('h1')).toMatchObject({ checkSkill: 5, checkDc: 14 });
  });

  it('restores recipients with their roll and outcome', () => {
    ldb.importHandouts({ handouts: [handout()], handoutRecipients: [recipient()] });
    const [r] = ldb.listHandoutRecipients('h1');
    expect(r).toMatchObject({ charId: 'c1', rollTotal: 17, outcome: 'success' });
  });

  it('round-trips through exportHandouts', () => {
    ldb.importHandouts({ handouts: [handout()], handoutRecipients: [recipient()] });
    const dump = ldb.exportHandouts();
    expect(dump.handouts).toHaveLength(1);
    expect(dump.handoutRecipients).toHaveLength(1);

    const fresh = openCampaignDb(':memory:');
    fresh.importHandouts(dump);
    expect(fresh.getHandout('h1').title).toBe('The Letter');
    expect(fresh.listHandoutRecipients('h1')).toHaveLength(1);
  });

  it('keeps an existing handout under an _old title', () => {
    ldb.importHandouts({ handouts: [handout({ title: 'Original' })] });
    ldb.importHandouts({ handouts: [handout({ title: 'Restored' })] });
    expect(ldb.listHandouts().map(h => h.title).sort()).toEqual(['Original _old', 'Restored']);
  });

  it('tolerates empty input', () => {
    expect(() => ldb.importHandouts()).not.toThrow();
    expect(ldb.listHandouts()).toHaveLength(0);
  });
});

// ── Events ────────────────────────────────────────────────────────────────────
describe('exportEvents / importEvents', () => {
  it('round-trips the Events screen blob', () => {
    ldb.saveEventsData({ log: [{ t: 'Sacked the keep' }], note: 'session 12' });
    const dump = ldb.exportEvents();
    const fresh = openCampaignDb(':memory:');
    fresh.importEvents(dump);
    expect(fresh.getEventsData()).toEqual({ log: [{ t: 'Sacked the keep' }], note: 'session 12' });
  });

  it('round-trips the calendar date', () => {
    ldb.saveCalendarState({ frYear: 1501, frMonth: 6, frDay: 15, frFestival: '' });
    const fresh = openCampaignDb(':memory:');
    fresh.importEvents(ldb.exportEvents());
    expect(fresh.getCalendarState()).toMatchObject({ frYear: 1501, frMonth: 6, frDay: 15 });
  });

  it('round-trips calendar events', () => {
    ldb.createCalendarEvent({ id: 'e1', title: 'Festival', description: 'Greengrass', frYear: 1501, frMonth: 4, frDay: 30, isPublic: true, eventType: 'event' });
    const fresh = openCampaignDb(':memory:');
    fresh.importEvents(ldb.exportEvents());
    const evs = fresh.listCalendarEvents({ isDM: true });
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ title: 'Festival', frYear: 1501 });
  });

  it('round-trips the weather log', () => {
    ldb.saveWeatherEntry({
      id: '1501-4-30', frYear: 1501, frMonth: 4, frDay: 30, frFestival: '', dateLabel: '30 Tarsakh', sessionNormal: 60,
      temperature: { roll: 10, level: 0, dice: [5, 5], value: 'Mild' },
      wind: { roll: 8, level: 0, value: 'Calm' },
      precipitation: { roll: 3, level: 0, value: 'Clear' },
    });
    const fresh = openCampaignDb(':memory:');
    fresh.importEvents(ldb.exportEvents());
    expect(fresh.listWeatherLog()).toHaveLength(1);
  });

  it('replaces the singletons rather than duplicating them', () => {
    ldb.saveEventsData({ note: 'first' });
    const dump = ldb.exportEvents();
    ldb.saveEventsData({ note: 'second' });
    ldb.importEvents(dump);
    expect(ldb.getEventsData()).toEqual({ note: 'first' });
    expect(ldb.exportEvents().eventsState).toHaveLength(1);
  });

  it('tolerates empty input', () => {
    expect(() => ldb.importEvents()).not.toThrow();
    expect(() => ldb.importEvents({})).not.toThrow();
  });
});
