---
name: speak
description: "Reply with a spoken voice message (text-to-speech) that plays inline in the chat. Use when a human spoke to you (payload.voice on their message) or asks to hear the answer. Uses secret/env OPENAI_API_KEY."
---

# Speak skill

Turns your reply text into an audio file and posts it as a voice message. The chat UI renders audio attachments with a player next to the text, so the human can listen instead of read.

## When to speak

- The human's latest `message.created` has `payload.voice` (they sent a hold-to-talk voice message or spoke on a live call). Answer in kind: speak the reply.
- The human explicitly asks you to say something out loud, read something, or reply with voice.
- Otherwise reply in text as usual. Do not speak long reports, code, tables, or links — summarize what matters in speech and keep the details in the text.

Agents in a realtime voice room already speak natively; this skill is for text agents.

## Secrets / auth

- Requires `OPENAI_API_KEY` in OrgOps secrets (the same key OpenAI models use); the runner injects it into shell tools.
- Optional env: `ORGOPS_TTS_MODEL` (default `gpt-4o-mini-tts`), `ORGOPS_TTS_VOICE` (default: a fixed voice picked from your agent name, so each agent sounds distinct).

## How to reply with voice

1. Write what you will say: conversational, short sentences, no markdown, no URLs, at most 4096 characters (aim for well under a minute of speech).
2. Generate the audio (the file is written under `.orgops-speech/` in your workspace):

   ```bash
   node --import tsx {baseDir}/assets/speak.ts -- --text "Sure, the deploy finished at three and all checks passed."
   ```

   For longer or quote-heavy text, write it to a file first and pass `--text-file reply.txt`.
   It prints JSON like `{"path":"/.../.orgops-speech/speech-1730000000000.mp3","bytes":48211,...}`.

3. Upload the file with `fs_upload` using that `path`. It returns `attachment` metadata (`fileId`, `name`, `mime: "audio/mpeg"`, `size`).
4. Post one `message.created` whose `text` is the same words (or a short written version) and whose `attachments` contains that attachment:

   ```json
   {
     "type": "message.created",
     "payload": {
       "text": "Sure, the deploy finished at three and all checks passed.",
       "attachments": [{ "fileId": "<fileId>", "name": "speech-1730000000000.mp3", "mime": "audio/mpeg", "size": 48211 }]
     }
   }
   ```

   Return it as your final event (or via `events_emit`). Always include the text too: it is the transcript, and other agents read text, not audio.

## Options

- `--voice <name>`: `marin`, `cedar`, `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`. Omit it to keep your own consistent voice.
- `--instructions "<tone>"`: delivery guidance, e.g. `"Calm and friendly, moderate pace."`
- `--format mp3|wav|opus|aac|flac` (default `mp3`).
- `--model <id>` and `--out <path>` to override the model or output file.

If generation fails (missing key, quota, network), reply in text and mention that voice was unavailable.
