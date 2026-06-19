---
name: Rendi API Integration
description: How the Rendi cloud video processing API works and the full integration pattern used in this project.
---

# Rendi API Integration

## Auth
- Header: `X-Api-Key: {RENDI_API_KEY}` (NOT Bearer, NOT api-key, NOT Authorization)

## Key Endpoints
- `GET /v1/files` — list files (auth check)
- `POST /v1/run-ffmpeg-command` — submit FFmpeg job
- `GET /v1/commands/{id}` — poll status

## run-ffmpeg-command request body
```json
{
  "input_files": { "in_1": "https://any-public-url/input.mp4" },
  "output_files": { "out_1": "output.mp4" },
  "ffmpeg_command": "-i {{in_1}} [flags] {{out_1}}"
}
```
- NEVER include `-y` flag (Rendi handles it internally, returns 400 if included)
- `{{in_1}}` / `{{out_1}}` are Rendi placeholders
- Input URL can be ANY publicly accessible URL (including our Replit dev domain)

## Polling response shape (SUCCESS)
```json
{
  "status": "SUCCESS",
  "output_files": {
    "out_1": {
      "storage_url": "https://storage.rendi.dev/trial_files/.../output.mp4",
      "mime_type": "video/mp4"
    }
  }
}
```
- Status values: `"PROCESSING"`, `"SUCCESS"`, `"FAILED"` (NOT "COMPLETED")
- Poll interval: 5s, max 120 attempts (10 min)

## Plan limitation
- Free/Sample plan: only allows `input_files` URLs from `storage.rendi.dev` (their own sample files)
- Paid plan: allows any public URL as input (including our Replit temp-files endpoint)
- Error on free plan: HTTP 403, `"Account is in Sample mode and cannot run commands on non-sample files"`

## Full integration architecture (server/rendi.ts + vite.config.ts)
1. Client chunks upload to `/api/upload-chunk` (45 MB each)
2. Client calls `POST /api/rendi-enhance` JSON `{sessionId, totalChunks, mode, settings}`
3. Server assembles chunks → `/tmp/vep-sessions/{sessionId}/input`
4. Server exposes `GET /api/temp-files/{sessionId}` → serves assembled file publicly
5. Server calls Rendi with `inputUrl = https://{REPLIT_DEV_DOMAIN}/api/temp-files/{sessionId}`
6. Server polls until SUCCESS, gets `storage_url`
7. Server proxies output from `storage_url` back to client as raw bytes

## Why: input URL approach
Could not determine correct query params for `GET /v1/files/upload-url` (always "invalid format").
Server-relay via REPLIT_DEV_DOMAIN works and is simpler — Replit dev domains are publicly accessible.
