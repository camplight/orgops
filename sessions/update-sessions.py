import argparse
import json
import re
import shutil
from pathlib import Path

SESSIONS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SESSIONS_DIR.parent
DEFAULT_SOURCE = Path.home() / ".claude" / "projects" / re.sub(r"[/.]", "-", str(PROJECT_ROOT))


def parse_arguments():
    parser = argparse.ArgumentParser(description="Sync recorded Claude Code sessions into sessions/")
    parser.add_argument("source", nargs="?", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument(
        "--include-unnamed",
        nargs="*",
        default=[],
        metavar="SESSION_ID",
        help="record these unnamed sessions (full ID or prefix) under their AI title",
    )
    return parser.parse_args()


def load(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def last_title(rows, key, field):
    titles = [row[field] for row in rows if row.get("type") == key]
    return titles[-1] if titles else None


def is_human_prompt(row):
    if row.get("type") != "user" or row.get("isMeta") or row.get("isSidechain"):
        return False
    content = row["message"]["content"]
    if isinstance(content, list):
        return all(b.get("type") == "text" for b in content) and not any(
            b["text"].startswith("[Request interrupted") for b in content
        )
    if isinstance(row.get("origin"), dict):
        return row["origin"].get("kind") == "human"
    return not content.startswith("<command-") and not content.startswith("<local-command")


def prompt_text(row):
    content = row["message"]["content"]
    return content if isinstance(content, str) else "\n".join(b["text"] for b in content)


def timestamps(rows):
    return [row["timestamp"] for row in rows if "timestamp" in row]


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def read_recorded(folder):
    brief = (folder / "brief.md").read_text()
    session_id = re.search(r"- Session ID: `([^`]+)`", brief).group(1)
    return session_id, brief


def recorded_sessions():
    folders = [p for p in sorted(SESSIONS_DIR.iterdir()) if (p / "brief.md").is_file()]
    return {read_recorded(folder)[0]: folder for folder in folders}


def render_brief(*, name, session_id, started, last_activity, prompts):
    body = "\n\n".join(f"## Prompt {i}\n\n{p}" for i, p in enumerate(prompts, 1))
    return (
        f"# {name}\n\n- Session ID: `{session_id}`\n- Started: {started}\n"
        f"- Last activity: {last_activity}\n- Human prompts: {len(prompts)}\n\n{body}\n"
    )


def recorded_prompt_count(brief):
    return int(re.search(r"- Human prompts: (\d+)", brief).group(1))


def update_resumed(folder, source_path, rows, report):
    session_id, brief = read_recorded(folder)
    prompts = [prompt_text(r).strip() for r in rows if is_human_prompt(r)]
    recorded = recorded_prompt_count(brief)
    name = last_title(rows, "custom-title", "customTitle") or last_title(rows, "ai-title", "aiTitle")
    last_activity = timestamps(rows)[-1]
    new_prompts = prompts[recorded:]
    appended = "".join(f"\n## Prompt {recorded + i}\n\n{p}\n" for i, p in enumerate(new_prompts, 1))
    with_activity = brief if "- Last activity:" in brief else brief.replace(
        "- Human prompts:", f"- Last activity: {last_activity}\n- Human prompts:", 1
    )
    updated = re.sub(r"^# .*$", f"# {name}", with_activity, count=1, flags=re.M)
    updated = re.sub(r"- Last activity: .*", f"- Last activity: {last_activity}", updated)
    updated = re.sub(r"- Human prompts: \d+", f"- Human prompts: {len(prompts)}", updated)
    transcript_stale = source_path.read_bytes() != (folder / "transcript.jsonl").read_bytes()
    if updated == brief and not new_prompts and not transcript_stale:
        return
    (folder / "brief.md").write_text(updated.rstrip("\n") + "\n" + appended)
    shutil.copyfile(source_path, folder / "transcript.jsonl")
    report.append(f"updated {folder.name}: +{len(new_prompts)} prompts (session {session_id})")


def add_new(source_path, rows, name, report):
    existing_numbers = [int(m.group(1)) for p in SESSIONS_DIR.iterdir() if (m := re.match(r"(\d+)-", p.name))]
    number = max(existing_numbers, default=0) + 1
    folder = SESSIONS_DIR / f"{number:02d}-{slugify(name)}"
    folder.mkdir()
    shutil.copyfile(source_path, folder / "transcript.jsonl")
    stamps = timestamps(rows)
    prompts = [prompt_text(r).strip() for r in rows if is_human_prompt(r)]
    (folder / "brief.md").write_text(
        render_brief(
            name=name, session_id=source_path.stem, started=stamps[0], last_activity=stamps[-1], prompts=prompts
        )
    )
    report.append(f"added {folder.name} ({len(prompts)} prompts)")


def write_index():
    entries = []
    for folder in SESSIONS_DIR.iterdir():
        if not (folder / "brief.md").is_file():
            continue
        session_id, brief = read_recorded(folder)
        rows = load(folder / "transcript.jsonl")
        stamps = timestamps(rows)
        kind = "named" if last_title(rows, "custom-title", "customTitle") else "unnamed"
        name = re.search(r"^# (.*)$", brief, flags=re.M).group(1)
        entries.append((stamps[0], folder.name, name, kind, session_id, stamps[-1], recorded_prompt_count(brief)))
    lines = [
        "# Claude Code sessions",
        "",
        "Chronological by creation time. Each folder holds `transcript.jsonl` (raw session) and `brief.md` (human prompts only).",
        "",
        "| # | Session | Type | Session ID | Started (UTC) | Last activity (UTC) | Prompts |",
        "|---|---|---|---|---|---|---|",
    ]
    for started, folder_name, name, kind, session_id, last, count in sorted(entries):
        number = int(folder_name.split("-")[0])
        lines.append(
            f"| {number} | [{name}]({folder_name}/brief.md) | {kind} | `{session_id}` | {started} | {last} | {count} |"
        )
    (SESSIONS_DIR / "INDEX.md").write_text("\n".join(lines) + "\n")


def main():
    arguments = parse_arguments()
    report = []
    recorded = recorded_sessions()
    loaded = [(source_path, load(source_path)) for source_path in arguments.source.glob("*.jsonl")]
    candidates = sorted((pair for pair in loaded if timestamps(pair[1])), key=lambda pair: timestamps(pair[1])[0])
    for source_path, rows in candidates:
        if source_path.stem in recorded:
            update_resumed(recorded[source_path.stem], source_path, rows, report)
            continue
        name = last_title(rows, "custom-title", "customTitle")
        if not name and any(source_path.stem.startswith(prefix) for prefix in arguments.include_unnamed):
            name = last_title(rows, "ai-title", "aiTitle")
        if name:
            add_new(source_path, rows, name, report)
    write_index()
    print("\n".join(report) if report else "no changes")


main()
