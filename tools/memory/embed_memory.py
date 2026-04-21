"""
Tool: Memory Embedding Generator
Purpose: Generate vector embeddings for memory entries to enable semantic search

Uses BAAI/bge-small-en-v1.5 via fastembed (ONNX, runs fully locally — no API key needed).
Stores embeddings as BLOBs in SQLite for cosine similarity search.

Usage:
    python tools/memory/embed_memory.py --all              # Embed all entries without embeddings
    python tools/memory/embed_memory.py --id 5             # Embed a specific entry
    python tools/memory/embed_memory.py --content "text"   # Get embedding for arbitrary text
    python tools/memory/embed_memory.py --stats            # Show embedding statistics
    python tools/memory/embed_memory.py --reindex          # Re-embed all entries

Dependencies:
    - fastembed
    - onnxruntime==1.18.1
    - sqlite3 (stdlib)
"""

import sys
import json
import argparse
import struct
from pathlib import Path
from typing import Optional, List, Dict, Any

# Import memory_db functions
sys.path.insert(0, str(Path(__file__).parent))
try:
    from memory_db import (
        get_entries_without_embeddings,
        store_embedding,
        get_entry,
        get_connection
    )
except ImportError:
    print("Error: Could not import memory_db", file=sys.stderr)
    sys.exit(1)

EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIMENSIONS = 384

_model = None


def _get_model():
    global _model
    if _model is None:
        try:
            from fastembed import TextEmbedding
            _model = TextEmbedding(EMBEDDING_MODEL)
        except ImportError:
            raise RuntimeError("fastembed not installed. Run: pip install fastembed==0.3.6")
    return _model


def embedding_to_bytes(embedding: List[float]) -> bytes:
    return struct.pack(f'{len(embedding)}f', *embedding)


def bytes_to_embedding(data: bytes) -> List[float]:
    count = len(data) // 4
    return list(struct.unpack(f'{count}f', data))


def generate_embedding(text: str, client=None) -> Dict[str, Any]:
    """Generate embedding for a text string using local fastembed model."""
    try:
        model = _get_model()
        embedding = list(list(model.embed([text]))[0])
        return {
            "success": True,
            "embedding": embedding,
            "model": EMBEDDING_MODEL,
            "dimensions": len(embedding),
            "usage": {"prompt_tokens": 0, "total_tokens": 0}
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def embed_entry(entry_id: int, client=None) -> Dict[str, Any]:
    entry_result = get_entry(entry_id)
    if not entry_result.get('success'):
        return entry_result

    entry = entry_result['entry']
    content = entry.get('content', '')
    if not content:
        return {"success": False, "error": f"Entry {entry_id} has no content"}

    embed_result = generate_embedding(content)
    if not embed_result.get('success'):
        return embed_result

    embedding_bytes = embedding_to_bytes(embed_result['embedding'])
    store_result = store_embedding(entry_id, embedding_bytes, EMBEDDING_MODEL)

    return {
        "success": store_result.get('success', False),
        "entry_id": entry_id,
        "content_preview": content[:100] + "..." if len(content) > 100 else content,
        "dimensions": embed_result['dimensions'],
        "model": EMBEDDING_MODEL
    }


def embed_all_pending(batch_size: int = 50, client=None) -> Dict[str, Any]:
    pending = get_entries_without_embeddings(limit=batch_size)
    if not pending.get('success'):
        return pending

    entries = pending.get('entries', [])
    if not entries:
        return {"success": True, "message": "No entries need embedding", "processed": 0}

    # Load model once, batch encode all content
    try:
        model = _get_model()
        contents = [e.get('content', '') for e in entries]
        embeddings = list(model.embed(contents))
    except Exception as e:
        return {"success": False, "error": str(e)}

    results = {"success": True, "processed": 0, "failed": 0, "entries": []}

    for entry, embedding in zip(entries, embeddings):
        entry_id = entry['id']
        try:
            embedding_bytes = embedding_to_bytes(list(embedding))
            store_result = store_embedding(entry_id, embedding_bytes, EMBEDDING_MODEL)
            if store_result.get('success'):
                results['processed'] += 1
                results['entries'].append({"id": entry_id, "success": True})
            else:
                results['failed'] += 1
                results['entries'].append({"id": entry_id, "success": False, "error": store_result.get('error')})
        except Exception as e:
            results['failed'] += 1
            results['entries'].append({"id": entry_id, "success": False, "error": str(e)})

    return results


def reindex_all(batch_size: int = 100, client=None) -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE memory_entries SET embedding = NULL, embedding_model = NULL')
    conn.commit()
    conn.close()
    return embed_all_pending(batch_size=batch_size)


def get_embedding_stats() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute('SELECT COUNT(*) as total FROM memory_entries WHERE is_active = 1')
    total = cursor.fetchone()['total']

    cursor.execute('SELECT COUNT(*) as count FROM memory_entries WHERE embedding IS NOT NULL AND is_active = 1')
    with_embeddings = cursor.fetchone()['count']

    cursor.execute('SELECT COUNT(*) as count FROM memory_entries WHERE embedding IS NULL AND is_active = 1')
    without_embeddings = cursor.fetchone()['count']

    cursor.execute('''
        SELECT embedding_model, COUNT(*) as count
        FROM memory_entries
        WHERE embedding IS NOT NULL AND is_active = 1
        GROUP BY embedding_model
    ''')
    by_model = {row['embedding_model']: row['count'] for row in cursor.fetchall()}

    cursor.execute('''
        SELECT AVG(LENGTH(content)) as avg_length
        FROM memory_entries
        WHERE embedding IS NOT NULL AND is_active = 1
    ''')
    avg_length = cursor.fetchone()['avg_length'] or 0
    conn.close()

    return {
        "success": True,
        "stats": {
            "total_active_entries": total,
            "with_embeddings": with_embeddings,
            "without_embeddings": without_embeddings,
            "coverage_percent": round(with_embeddings / total * 100, 1) if total > 0 else 0,
            "by_model": by_model,
            "avg_content_length": round(avg_length, 0)
        }
    }


def main():
    parser = argparse.ArgumentParser(description='Memory Embedding Generator (local, no API key)')
    parser.add_argument('--all', action='store_true', help='Embed all entries without embeddings')
    parser.add_argument('--id', type=int, help='Embed a specific entry by ID')
    parser.add_argument('--content', help='Get embedding for arbitrary text (returns JSON)')
    parser.add_argument('--reindex', action='store_true', help='Re-embed all entries')
    parser.add_argument('--stats', action='store_true', help='Show embedding statistics')
    parser.add_argument('--batch-size', type=int, default=50, help='Batch size for --all')

    args = parser.parse_args()
    result = None

    if args.stats:
        result = get_embedding_stats()

    elif args.content:
        result = generate_embedding(args.content)
        if result.get('success'):
            result['embedding_preview'] = result['embedding'][:5] + ['...']
            del result['embedding']

    elif args.id:
        result = embed_entry(args.id)

    elif args.reindex:
        print("Re-indexing all entries (this will clear existing embeddings)...")
        result = reindex_all(batch_size=args.batch_size)

    elif args.all:
        result = embed_all_pending(batch_size=args.batch_size)

    else:
        parser.print_help()
        sys.exit(0)

    if result:
        if result.get('success'):
            print(f"OK {result.get('message', 'Success')}")
        else:
            print(f"ERROR {result.get('error', 'Unknown error')}")
            sys.exit(1)
        print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
