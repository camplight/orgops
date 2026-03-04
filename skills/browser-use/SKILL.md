---
name: browser-use
description: Automate browser tasks using browser-use.
metadata: {"openclaw":{"requires":{"bins":["python3"]}}}
---
# Browser Use

Automate browser tasks using the browser-use Python package.

## Requirements

- Python 3.11+
- browser-use installed (`uv add browser-use`)
- Chromium installed (`uvx browser-use install`)

## Usage

```bash
bun run {baseDir}/assets/run.ts -- "<task>"
```

## Example

```bash
bun run {baseDir}/assets/run.ts "Find OrgOps repo issues labeled bug"
```
