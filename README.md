# RPG Play — D&D 5e Character Sheet & Virtual Table

A self-hosted web application for running D&D 5e sessions. Includes a full character sheet, a shared virtual battle map, initiative tracking, monster management, loot system, and a merchant shop — all running in real time across every connected browser.

---

## Features

### Character Sheet
- Full D&D 5e character sheet with stats, skills, saving throws, and spell slots
- Dice rolling with 3D animation (broadcasts to all table viewers simultaneously)
- Roll history per character
- Advantage / disadvantage rolls with dual-die animation
- Portrait images, media attachments
- Password protection per character
- Multiple themes (Dark Gold, Parchment, Midnight)

### Virtual Table
- Shared battle map with grid overlay
- Token system — place PC, NPC, and monster tokens on the map
- Token portraits (per character and per monster)
- HP tracking panel per token with damage / heal / temp HP
- Monster visibility toggle (DM can hide/reveal monsters from players in real time)
- Fog of war regions (DM draws, players see darkness)
- Hidden items on the map (traps, chests, doors, notes)
- Initiative tracker with turn order
- Ping tool, ruler, zoom
- Real-time sync across all connected clients via SSE / WebSocket

### DM Tools
- Monster library with full stat blocks, importer, and editor
- Map Prep screen — upload map images, draw fog, place hidden items, export/import maps as `.map.json` files
- Loot management and distribution
- Merchant shop system
- Master password protects all DM actions

### Database Modes
| Mode | Description |
|---|---|
| `localdb` | SQLite + WebSocket. No cloud required. Best for LAN play. |
| `instantdb` | Cloud database via [InstantDB](https://www.instantdb.com). Accessible anywhere. |

---

## Quick Start with Docker

Docker is the recommended way to run the application locally.

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

### 1. Clone the repository

```bash
git clone https://github.com/irmakh/rpg-play.git
cd rpg-play
```

### 2. Configure environment

```bash
cp .env.docker .env
```

Open `.env` and set your values:

```bash
# Choose database mode: localdb (no cloud) or instantdb (cloud)
DB_PROVIDER=localdb

# Required only when DB_PROVIDER=instantdb
INSTANT_APP_ID=your-instantdb-app-id
INSTANT_ADMIN_TOKEN=your-instantdb-admin-token

# Master password — used by the DM to access all protected screens
MASTER_PASSWORD=your-master-password

# Port settings
PORT=3000
HOST_PORT=3000
```

> **Tip:** For local play with no cloud setup, set `DB_PROVIDER=localdb` and only `MASTER_PASSWORD` is required.

### 3. Start the application

```bash
./docker-start.sh
```

Or manually:

```bash
docker-compose build
docker-compose up -d
```

### 4. Open in browser

```
http://localhost:3000
```

| Page | URL | Access |
|---|---|---|
| Character Sheet | `/` | Players |
| Virtual Table | `/table.html` | Players + DM |
| DM Dashboard | `/dm.html` | DM (master password) |
| Monsters | `/monsters.html` | DM |
| Map Prep | `/prepare-map.html` | DM |
| Merchant | `/merchant.html` | DM |
| Loot | `/loot.html` | DM |

---

## Manual Installation (without Docker)

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or higher

### Steps

```bash
git clone https://github.com/irmakh/rpg-play.git
cd rpg-play/Application

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your values

# Start the server
npm start
```

The server starts on `http://localhost:3000` (or the `PORT` set in `.env`).

---

## Docker Commands Reference

```bash
# Start
./docker-start.sh

# Stop
./docker-stop.sh

# View live logs
docker-compose logs -f

# Restart
docker-compose restart

# Rebuild after dependency changes
docker-compose build --no-cache
docker-compose up -d

# Open a shell inside the container
docker-compose exec app sh
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_PROVIDER` | Yes | `instantdb` | `localdb` or `instantdb` |
| `MASTER_PASSWORD` | Yes | — | DM master password |
| `INSTANT_APP_ID` | instantdb only | — | InstantDB application ID |
| `INSTANT_ADMIN_TOKEN` | instantdb only | — | InstantDB admin token |
| `PORT` | No | `3000` | Port inside the container |
| `HOST_PORT` | No | `3000` | Port exposed on your machine |
| `WS_URL` | No | auto | Override WebSocket URL (e.g. `ws://192.168.1.10:3000/ws`) |

---

## Troubleshooting

**Port already in use**
```bash
# Change HOST_PORT in .env
HOST_PORT=3001
docker-compose up -d
```

**Container won't start**
```bash
docker-compose logs
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d
```

**Reset databases (start fresh)**
```bash
docker-compose down
rm Application/*.db
docker-compose up -d
```

**Windows — file sharing issues**
Docker Desktop → Settings → Resources → File Sharing → make sure your drive is enabled.

---

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** SQLite (`better-sqlite3`) for local mode / [InstantDB](https://www.instantdb.com) for cloud mode
- **Real-time:** WebSocket (`ws`) for local mode / Server-Sent Events for cloud mode
- **Frontend:** Vanilla JS, HTML, CSS — no build step required

---

## Project Structure

```
rpg-play/
├── Application/
│   ├── server.js           # Express server + API
│   ├── db/
│   │   └── localdb.js      # SQLite database layer
│   ├── public/
│   │   ├── index.html      # Character sheet
│   │   ├── table.html      # Virtual table
│   │   ├── dm.html         # DM dashboard
│   │   ├── monsters.html   # Monster library
│   │   ├── prepare-map.html# Map prep tool
│   │   ├── js/             # Client-side scripts
│   │   ├── css/            # Stylesheets
│   │   └── img/            # Static images
│   ├── package.json
│   └── .env.example
├── Dockerfile.dev
├── docker-compose.yml
├── docker-start.sh
├── docker-stop.sh
├── .env.docker             # Environment template for Docker
└── .env.template           # General environment template
```
