# Character Sheet Project

> An agentic system built on the GOTCHA Framework

## Project Structure

This project follows the **GOTCHA Framework** — a 6-layer architecture for reliable agentic systems:

### **GOT** (The Engine)
- **Goals** (`goals/`) — Process definitions (what needs to happen)
- **Orchestration** — AI manager coordinates execution
- **Tools** (`tools/`) — Deterministic scripts that do the work

### **CHA** (The Context)
- **Context** (`context/`) — Reference material and domain knowledge
- **Hardprompts** (`hardprompts/`) — Reusable instruction templates
- **Args** (`args/`) — Behavior settings

## Directory Structure

```
char_sheet/
├── Application/        # Main application code
├── goals/             # Process definitions
│   └── manifest.md    # Index of all goals
├── tools/             # Deterministic scripts
│   ├── memory/        # Memory management tools
│   └── manifest.md    # Index of all tools
├── args/              # Behavior settings
├── context/           # Domain knowledge
├── hardprompts/       # Instruction templates
├── memory/            # Persistent memory
│   ├── MEMORY.md      # Curated facts (always loaded)
│   └── logs/          # Daily session logs
├── data/              # Databases and data files
│   ├── memory.db      # Memory entries database
│   └── activity.db    # Task tracking database
├── .tmp/              # Temporary/scratch work
├── .env               # Environment variables (gitignored)
└── CLAUDE.md          # System handbook
```

## Getting Started

1. Copy `.env.template` to `.env` and add your API keys
2. Check `goals/manifest.md` for available workflows
3. Check `tools/manifest.md` for available tools
4. Read `CLAUDE.md` for the complete system handbook

## Memory System

The project includes persistent memory across sessions:
- **MEMORY.md** - Curated facts, always loaded
- **Daily logs** - Session notes in `memory/logs/`
- **Databases** - SQLite databases for searchable memory

## Philosophy

**LLMs are probabilistic. Business logic is deterministic.**

This structure bridges that gap through separation of concerns:
- AI makes smart decisions
- Tools execute perfectly
- Goals define clear processes
- Each layer has one responsibility

---

*Initialized: 2026-03-27*
