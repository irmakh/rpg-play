# Hard Prompts Directory

> Reusable instruction templates for LLM sub-tasks

## Purpose

Hard prompts are fixed instruction templates used for specific transformation or generation tasks.

## Examples

- Convert outline to full post
- Rewrite in specific voice
- Summarize transcript
- Create visual brief
- Generate test cases
- Extract key points

## Format

Use markdown or text files, one per transformation type:

```markdown
# hardprompts/outline_to_post.md

You are a content writer. Convert the following outline into a complete blog post.

Requirements:
- Expand each point into 2-3 paragraphs
- Maintain logical flow
- Include concrete examples
- Use active voice

Outline:
{OUTLINE}
```

## Usage

When a goal requires LLM transformation, reference the appropriate hard prompt template. Variables in {CURLY_BRACES} get replaced with actual content.

---

*Add your hard prompts here as needed*
