# Imagery Pipeline Workflow [I-2 → I-3 → I-4]

## Overview
The imagery pipeline generates social-media-ready product photos for content calendar entries.
It runs automatically after copy is approved (`status: copy_approved`).

## Pipeline Steps

### I-2: Scene Generation — GPT Image 2
- **Model:** `gpt-image-2` (OpenAI images.edit)
- **Input:** Product image (white background) + scene prompt
- **Output:** Scene image (product composited into a room setting)
- **Quality:** `medium` by default (configurable via `GPT_IMAGE_QUALITY` env var)
- **Size:** 1024x1024
- **Timeout:** 90s
- **Dry-run:** No `OPENAI_API_KEY` → returns 1x1 transparent PNG placeholder

### I-3: Text Overlay — sharp SVG compositing
- Process: sharp composites SVG text layers onto the scene image
- 6 preset positions: title, subtitle, promo_badge, selling_point, cta, logo_area
- Deterministic — no AI involved, pure programmatic layout
- See `lib/text-overlay.js` for preset config

### I-4: Store Image — Supabase Storage
- Uploads final composited image to Supabase Storage
- Returns public URL for use in review card and publishing

## Environment Variables
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key for GPT Image 2 |
| `GPT_IMAGE_QUALITY` | No | `medium` | Quality: low / medium / high |
| `SUPABASE_URL` | No | — | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | No | — | Supabase service_role key |

## State Machine (image_status)
```
pending → generating → generated → composited → stored
                    ↘ failed ↗
                         ↘ generating (retry)
                              stored → generating (regenerate)
```

## Pillar → Scene Mapping
| Pillar | Default Scene |
|--------|---------------|
| product | Modern living room, elegant decor, warm ambient lighting |
| case | Cozy Malaysian home interior, real installation setting |
| promo | Festive event display, promotional showcase |
| story | Stylish contemporary interior, lifestyle home setting |

Festival keywords (Chinese New Year, Hari Raya, Deepavali, Christmas, Merdeka, etc.)
override the default scene with holiday-appropriate descriptions.

## Key Files
- `lib/scene-gen.js` — GPT Image 2 integration + prompt engine
- `lib/text-overlay.js` — sharp SVG text compositing
- `lib/store-image.js` — Supabase Storage upload
- `lib/pipeline.js` — Orchestrator (chains I-2 → I-3 → I-4)
- `lib/image-state.js` — Image sub-state machine

## Testing
```bash
# Unit tests (no API key needed)
cd /root/fanz-bots/marketing-bot
node test-scene-gen.js
node test-text-overlay.js
node test-store-image.js

# Real API test (requires OPENAI_API_KEY on Railway)
cd /root/fanz-bots/marketing-bot && railway run node test-gpt-image2.js

# Full E2E (requires SUPABASE_URL + SUPABASE_SERVICE_KEY on Railway)
railway run node test-e2e-imagery.js
```