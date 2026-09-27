// Written by Irmak Hakman — 2026-09-26 16:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Where an uploaded file may live — the one place that decides.
 *
 * Until v235 every read, write and delete of an upload joined a URL onto the
 * public folder after checking only that it STARTED with '/uploads/'. A backup
 * is a file the DM uploads, and its records carry those URLs, so a restore with
 * a record like { dataUrl: '/uploads/../../server.js' } wrote straight over the
 * server's own code — any campaign's DM, or anyone holding a stolen DM session,
 * could run code on the server at the next restart. A record's `id` and
 * `mime_type` were just as trusted: the id became the filename, and the MIME
 * type's second half became the extension, so 'text/html' planted a page that
 * the server would serve from its own origin.
 *
 * The rules, for every caller:
 *   - the resolved path stays inside the uploads folder;
 *   - it is in THIS campaign's folder, or in one of the shared folders files
 *     were written to before campaigns had folders of their own — never in
 *     another campaign's;
 *   - a file being WRITTEN has an extension from a fixed list of media types,
 *     so nothing the browser would run as a page or a script can be created;
 *   - an id used as a filename is reduced to letters, digits, '-' and '_'.
 */
import path from 'path';

// Folders files were written to directly under uploads/ before each campaign
// got its own (uploads/<campaignId>/<subdir>/). Files written then still exist
// and their URLs are still in the databases, so they stay reachable.
export const LEGACY_UPLOAD_DIRS = new Set([
  'calendar', 'campaigns', 'characters', 'handouts', 'maps', 'media',
  'monsters', 'sounds', 'tokens', 'treasury', 'waiting',
]);

// The extensions the server itself ever writes. Anything else — .html, .svg,
// .js — is something a browser would run, and is refused.
export const UPLOAD_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  'mp4', 'webm', 'mpeg',
  'mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac',
]);

// MIME type → extension, for every type an upload route accepts. A type that
// is not here gets 'bin', never a string lifted from the MIME type itself.
export const MIME_TO_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/mpeg': 'mpeg',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/webm': 'webm',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac',
};

export function mimeToExt(mimeType) {
  return MIME_TO_EXT[String(mimeType || '').toLowerCase()] || 'bin';
}

/** A campaign id as it appears in a folder name. */
export function campaignDir(campaignId) {
  return String(campaignId || '').replace(/[^A-Za-z0-9._-]/g, '');
}

/** An id made safe to be a filename, or '' if nothing is left of it. */
export function safeFileId(id) {
  return String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
}

/**
 * The absolute path behind an '/uploads/...' URL, or null when it is not one
 * this campaign may touch.
 *
 * @param {string} uploadsDir   absolute path of public/uploads
 * @param {string} fileUrl      e.g. '/uploads/<campaign>/maps/abc.png'
 * @param {object} opts
 * @param {string} opts.campaignId  the campaign of the current request
 * @param {boolean} [opts.forWrite] also require an extension from UPLOAD_EXTS
 */
export function resolveUploadPath(uploadsDir, fileUrl, { campaignId = '', forWrite = false } = {}) {
  if (typeof fileUrl !== 'string' || !fileUrl.startsWith('/uploads/')) return null;
  let rel = fileUrl.slice('/uploads/'.length).split(/[?#]/)[0];
  // Decode exactly as express.static does before it serves the file, so the
  // path checked here is the path that would be read — '%2e%2e' included.
  try { rel = decodeURIComponent(rel); } catch { return null; }
  if (!rel || rel.includes('\0')) return null;

  const root = path.resolve(uploadsDir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return null;             // escaped the folder

  const parts = path.relative(root, abs).split(path.sep);
  if (parts.length < 2) return null;                              // a folder, or a loose file
  const own = campaignDir(campaignId);
  const inOwn = own && parts[0] === own;
  if (!inOwn && !LEGACY_UPLOAD_DIRS.has(parts[0])) return null;   // another campaign's folder

  if (forWrite && !UPLOAD_EXTS.has(path.extname(abs).slice(1).toLowerCase())) return null;
  return abs;
}
