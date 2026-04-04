# Tools Manifest

> Master list of all available tools and their functions
> Each tool is a deterministic script that executes one specific job

## Memory Tools (`tools/memory/`)

- **memory_read.py** - Read memory entries from database and format for display
- **memory_write.py** - Write new memory entries and update MEMORY.md
- **memory_db.py** - Direct database operations (search, update, delete memory entries)
- **semantic_search.py** - Search memory using semantic similarity (embeddings)
- **hybrid_search.py** - Combined keyword + semantic search for best results
- **embed_memory.py** - Generate and manage embeddings for memory entries

---

*Add new tools here as they are created*
*Format: `- **script_name.py** - One-sentence description of what it does`*
*Organize by workflow/category*
