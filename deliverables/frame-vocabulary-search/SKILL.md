---
name: frame-vocabulary-search
description: "Turn a paused short-video frame or camera image into a personalized language-learning loop: identify visual intent, select CEFR-appropriate expressions, generate a frame word card, and decide whether to save, review, suppress, or deepen learning. Use when building a Douyin Feed long-press visual-search experience, a camera vocabulary experience, or any workflow that must extend image recognition into reusable language memory."
---

# Frame Vocabulary Search

## Product mission

People who studied English for years often cannot name their own life. Convert the "how do you say this in English?" moment of curiosity into a low-friction visual search action. Do not stop at naming an object. Return the expression the user is most likely to need in this specific visual context, then advance it into an actionable memory loop.

There are two equal entries: a camera frame of the life in front of the user, and a paused short-video frame of the life the user wants. Uploaded images use the same workflow. Voice and typed text are optional intent refinements, not prerequisites.

## Input contract

Require an image or video frame and the following context. Use safe defaults only when a field is missing.

```json
{
  "frame": "image bytes or URL",
  "source": "douyin_feed | camera | upload",
  "target_language": "en | ja | ko",
  "cefr_band": "A1-A2 | B1-B2 | C1-C2",
  "user_intent": "optional: what is this / how to say this / how is it used",
  "selected_region": "optional normalized x,y,width,height",
  "saved_concepts": ["optional canonical concepts"],
  "mastered_concepts": ["optional canonical concepts"],
  "blocked_concepts": ["optional canonical concepts"],
  "feedback": "optional: save | skip | know | review_again"
}
```

## Workflow

### 1. Resolve the visual intent

Read the frame as a scene, not as an isolated object list.

1. If `selected_region` exists, make it the primary subject.
2. Otherwise identify the dominant user-noticeable object, action, or scene relationship.
3. Infer why the user paused: name it, describe what is happening, or learn a usable scene expression.
4. Prefer visual facts that cannot be specified as efficiently through a text query alone.

Do not identify people, infer sensitive traits, or fabricate brands, locations, creators, prices, or events not visible in the frame.

### 2. Build a learning set, not a detection list

Return 3–5 non-overlapping candidates. Cover the scene in this priority order:

1. **Action or relationship** — highest learning value when visually evident.
2. **Specific object or tool** — only if it is central to the frame.
3. **Scene expression** — an expression that helps the user describe the complete moment.

Exclude concepts already in `mastered_concepts` or `blocked_concepts`. Deprioritize `saved_concepts` unless the user asks for review or the current context teaches a clearly different usage.

### 3. Apply the CEFR lens

Use the same visual scene to create a different “next step” for each band.

| Band | Selection rule | Example for a cafe frame |
| --- | --- | --- |
| A1–A2 | High-frequency visible nouns and basic actions | cup, chair, pour coffee |
| B1–B2 | Natural collocations and complete actions | place an order, steam the milk |
| C1–C2 | Precise craft vocabulary and nuanced scene expressions | froth the milk, counter service |

Never choose difficult wording merely to make the output look advanced. Difficulty must map to a visible learning gain.

### 4. Generate an expandable frame card

For the selected expression, provide a concise Chinese meaning in the frame's actual context; pronunciation or system-speech-ready text; one natural target-language example grounded in the frame; a Chinese translation; three practical collocations; and a canonical `concept` key for deduplication and spaced review.

When the user taps a word inside the example, repeat this workflow using that word as `user_intent`. Preserve the original frame and sentence as context. This is the “see → understand → continue exploring” extension, not a separate dictionary page.

### 5. Close the loop with an explicit next action

| Feedback | Product action | Next recommendation |
| --- | --- | --- |
| `save` | Create/update a private frame word card with the source frame | Offer immediate recall once; schedule a later review |
| `know` | Increase mastery and postpone the concept | Avoid repeating it in the next nearby scene |
| `review_again` | Keep the card due | Resurface it with the original frame soon |
| `skip` | Do not save | Keep neutral; never treat one skip as permanent dislike |
| `block` | Add canonical concept to block list | Never recommend it again unless user restores it |

The response must always expose a clear next action: **save**, **continue exploring**, **keep watching**, or **review now**. Recognition without an action is incomplete.

## Output contract

Return strict JSON only. Coordinates are percentages relative to the source frame.

```json
{
  "scene_summary": {
    "target_language": "A barista is steaming milk at a coffee counter.",
    "zh": "咖啡师正在吧台给牛奶打蒸汽。"
  },
  "learning_points": [
    {
      "concept": "steam_milk",
      "text": "steam the milk",
      "meaning": "给牛奶打蒸汽",
      "kind": "verb | noun | phrase | person",
      "cefr": "B1",
      "position": { "x": 54, "y": 46 },
      "why_this_frame": "动作、工具与结果在画面中同时可见。",
      "detail": {
        "phonetic": "/stiːm ðə mɪlk/",
        "context": "The barista is steaming the milk for a latte.",
        "translation": "咖啡师正在为拿铁给牛奶打蒸汽。",
        "collocations": ["steam milk for a latte", "milk pitcher", "create microfoam"]
      },
      "actions": ["save", "explore_example", "keep_watching"]
    }
  ],
  "satisfaction_check": {
    "ask": "这就是你想知道的画面表达吗？",
    "fallback_actions": ["select_region", "change_cefr_band", "ask_with_voice_or_text"]
  }
}
```

## Quality gates

Before returning, verify all of the following:

- The result is grounded in visible evidence, not a generic vocabulary list.
- Each candidate is distinct and has a clear visual anchor.
- The CEFR band matches the stated selection rule.
- `concept` is stable, lowercase, and reusable for deduplication.
- The example is short, natural, and consistent with the frame.
- Chinese meaning explains the current use rather than giving an unhelpful dictionary dump.
- At least one action can move the user into a saved card, review, or deeper visual exploration.

If image understanding or structured generation fails, return one conservative, frame-grounded card with an explicit retry action. Never expose raw model reasoning or a broken JSON response to the user.

## Surfaces and growth integration

Use this skill behind three product surfaces:

1. **Camera expression mode** — "the life in front of you": let a user point at real-world objects or actions; preserve the same save-and-review loop.
2. **Feed long-press / pause tag** — "the life you want": the high-intent content entrance; show 1–3 lightweight tags before opening the full card.
3. **Frame word library**: return users to the original scene for retrieval practice, increasing the chance of content replay and repeat search.

Measure visual-search trigger rate, tag click-through, save rate, immediate recall completion, scheduled-review completion, and same-video replay after save. Treat these as validation metrics, not claims of achieved business results.
