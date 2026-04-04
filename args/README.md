# Args Directory

> Behavior settings that control how the system operates

## Purpose

Args files contain configuration that changes **how** the system behaves without modifying goals or tools.

## Examples

- Daily themes or modes
- Framework preferences
- Content length settings
- Scheduling parameters
- Model selection
- Output formats

## Format

Use YAML or JSON files organized by category:

```yaml
# example: content_settings.yaml
default_length: medium
tone: professional
include_examples: true
```

## Usage

The AI orchestrator reads args files before executing workflows. Changing args changes behavior instantly without code changes.

---

*Add your args files here as needed*
