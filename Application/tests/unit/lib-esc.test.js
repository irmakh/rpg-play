/**
 * Unit tests for the esc() HTML-escaping function in lib/esc.js.
 * Pure function — no DOM, no globals needed.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../public/js/lib/esc.js'), 'utf-8');

function load() {
  const ctx = createContext({});
  runInContext(SRC, ctx);
  return ctx.esc;
}

const esc = load();

describe('esc', () => {
  it('returns an empty string for null', () => {
    expect(esc(null)).toBe('');
  });

  it('returns an empty string for undefined', () => {
    expect(esc(undefined)).toBe('');
  });

  it('returns an empty string for empty string', () => {
    expect(esc('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(esc('Hello World')).toBe('Hello World');
  });

  it('escapes &', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('escapes <', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes >', () => {
    expect(esc('1 > 0')).toBe('1 &gt; 0');
  });

  it('escapes "', () => {
    expect(esc('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it('escapes all special characters together', () => {
    expect(esc('<a href="page?a=1&b=2">link</a>')).toBe(
      '&lt;a href=&quot;page?a=1&amp;b=2&quot;&gt;link&lt;/a&gt;'
    );
  });

  it('converts numbers to string', () => {
    expect(esc(42)).toBe('42');
  });

  it('converts booleans to string', () => {
    expect(esc(true)).toBe('true');
  });
});
