# Docker Development Setup

> Local development environment for the Character Sheet application

## Quick Start

### 1. Prerequisites

- Docker Desktop installed and running
- Docker Compose (included with Docker Desktop)

### 2. Setup Environment

```bash
# Copy the environment template
cp .env.docker .env

# Edit .env with your actual credentials
# Required: INSTANT_APP_ID, INSTANT_ADMIN_TOKEN, MASTER_PASSWORD
```

### 3. Start Development Container

**Using the script (recommended):**
```bash
./docker-start.sh
```

**Or manually:**
```bash
docker-compose build
docker-compose up -d
```

### 4. Access the Application

Open your browser to: **http://localhost:3000**

(Or whatever port you set in `HOST_PORT` in your `.env`)

---

## Common Commands

### View Logs
```bash
docker-compose logs -f
```

### Access Container Shell
```bash
docker-compose exec app sh
```

### Restart Container
```bash
docker-compose restart
```

### Stop Container
```bash
./docker-stop.sh
# or
docker-compose down
```

### Rebuild Container (after dependency changes)
```bash
docker-compose build --no-cache
docker-compose up -d
```

---

## How It Works

### File Structure
```
char_sheet/
├── Dockerfile.dev       # Development container definition
├── docker-compose.yml   # Container orchestration
├── .dockerignore        # Files to exclude from build
├── .env.docker          # Environment template
├── .env                 # Your actual environment (gitignored)
├── docker-start.sh      # Quick start script
└── docker-stop.sh       # Quick stop script
```

### Volume Mounts

The container mounts your local files for live development:

- **Application code** → `/app` (hot reload enabled)
- **node_modules** → Named volume (better performance on Windows)
- **Databases** → `characters.db`, `media.db` (persistent)

Any changes you make to files in `Application/` are immediately reflected in the container.

### Port Mapping

By default:
- Container internal port: `3000` (or what you set in `PORT`)
- Host machine port: `3000` (or what you set in `HOST_PORT`)

You can change these in your `.env` file.

---

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose logs

# Rebuild from scratch
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d
```

### Database issues
```bash
# The SQLite databases are mounted from your Application/ folder
# If you need to reset, stop the container and delete the .db files
docker-compose down
rm Application/*.db
docker-compose up -d
```

### Port already in use
```bash
# Change HOST_PORT in .env to a different port
echo "HOST_PORT=3001" >> .env
docker-compose up -d
```

### Permission issues (Windows)
```bash
# Make sure Docker Desktop has access to your drive
# Settings → Resources → File Sharing
```

---

## Development Workflow

1. **Edit code** in `Application/` folder (use your normal IDE)
2. **Container auto-reloads** when files change
3. **Test** at http://localhost:3000
4. **View logs** with `docker-compose logs -f`
5. **Databases persist** between container restarts

When ready to deploy to production, use your existing server deployment process (without Docker).

---

## Environment Variables

Edit `.env` to configure:

```bash
# Application
PORT=3000                    # Port inside container
HOST_PORT=3000              # Port on your machine

# InstantDB
INSTANT_APP_ID=...          # Your InstantDB app ID
INSTANT_ADMIN_TOKEN=...     # Your InstantDB admin token

# Security
MASTER_PASSWORD=...         # DM master password

# Node
NODE_ENV=development        # Environment mode
```

---

*This is for development only. Production deployment continues without Docker.*
