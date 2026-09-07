'use strict';

// Native save dialogs for everything the web app hands to the browser as a
// download: database backups, map exports, character XML, story archives.
// In a browser these land silently in the Downloads folder; here the user picks
// the destination and gets a "Show in folder" button when it finishes.

const { session, dialog, shell, BrowserWindow, Notification } = require('electron');
const path = require('path');
const config = require('./config');

// Suggests a file-type filter from the extension so the dialog is not a bare
// "All Files" list. Extensions the app actually produces come first.
function filtersFor(filename) {
  const ext = path.extname(filename || '').replace('.', '').toLowerCase();
  const named = {
    db: 'Database backup',
    sqlite: 'Database backup',
    json: 'JSON file',
    xml: 'Character file',
    zip: 'Archive',
    png: 'Image',
    jpg: 'Image',
    jpeg: 'Image',
    webp: 'Image',
    mp3: 'Audio',
    mp4: 'Video',
    pdf: 'PDF document',
  };
  const filters = [];
  if (ext && named[ext]) filters.push({ name: named[ext], extensions: [ext] });
  else if (ext) filters.push({ name: ext.toUpperCase() + ' file', extensions: [ext] });
  filters.push({ name: 'All files', extensions: ['*'] });
  return filters;
}

function install() {
  session.defaultSession.on('will-download', async (event, item, webContents) => {
    const filename = item.getFilename();
    const lastDir = config.get('lastDownloadDir');
    const parent = BrowserWindow.fromWebContents(webContents) || undefined;

    // Electron would show its own dialog if no save path is set, but doing it
    // explicitly is what lets us remember the folder and report completion.
    const result = await dialog.showSaveDialog(parent, {
      title: 'Save file',
      defaultPath: lastDir ? path.join(lastDir, filename) : filename,
      filters: filtersFor(filename),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (result.canceled || !result.filePath) {
      item.cancel();
      return;
    }

    const savePath = result.filePath;
    config.set('lastDownloadDir', path.dirname(savePath));
    item.setSavePath(savePath);

    item.once('done', (doneEvent, state) => {
      if (state === 'completed') {
        if (Notification.isSupported()) {
          const note = new Notification({
            title: 'Download complete',
            body: path.basename(savePath),
          });
          note.on('click', () => shell.showItemInFolder(savePath));
          note.show();
        }
      } else if (state === 'interrupted') {
        dialog.showMessageBox(parent, {
          type: 'error',
          title: 'Download failed',
          message: `${filename} could not be saved.`,
          detail: 'The transfer was interrupted. Check the server connection and try again.',
        });
      }
      // state === 'cancelled' is the user's own doing; stay quiet.
    });
  });
}

module.exports = { install };
