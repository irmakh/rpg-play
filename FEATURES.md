# D&D Character Sheet - Features

## Database Backup

### Overview
The DM Panel now includes a complete database backup feature that exports all application data.

### What Gets Backed Up

**InstantDB Data:**
- Characters (all character sheets and passwords)
- Media (character portraits and attachments)
- Shop Configuration
- Shop Items
- Purchase Logs
- Loot Items
- Loot Logs
- Monsters

**SQLite Data:**
- Shared Media (DM chat media metadata)

### How to Use

1. Navigate to the **DM Panel** (`dm.html`)
2. Enter your master password to unlock
3. Click the **💾 Backup** button in the top-right header
4. A JSON file will download automatically: `dnd-backup-YYYY-MM-DD.json`

### Backup File Format

```json
{
  "timestamp": "2026-03-27T12:00:00.000Z",
  "version": "1.0",
  "instantdb": {
    "characters": [...],
    "media": [...],
    "shopConfig": [...],
    "shopItems": [...],
    "purchaseLogs": [...],
    "lootItems": [...],
    "lootLogs": [...],
    "monsters": [...]
  },
  "sqlite": {
    "shared_media": [...]
  }
}
```

### Security

- Requires **master password** authentication
- Only accessible from DM Panel
- Includes encrypted password hashes (not plain passwords)
- Can be stored securely for disaster recovery

### Restoration

> **Note:** Restore functionality is not yet implemented. The backup provides a complete data snapshot that can be used for:
> - Manual data recovery
> - Auditing
> - Migrating to a new instance
> - Historical records

### Technical Details

**Backend Endpoint:** `GET /api/admin/backup`
- Requires: `x-master-password` header
- Returns: JSON file with complete database export
- Status codes: 200 (success), 401 (unauthorized), 500 (error)

**Frontend Implementation:**
- Location: `public/dm.html`
- Function: `downloadBackup()`
- Triggers automatic file download via blob URL

---

*Added: 2026-03-27*
