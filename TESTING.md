# Testing

100% test coverage is the goal for safe vibe coding: tests let the project move quickly without turning every change into a guess.

## Commands

- `npm test` runs the Vitest suite once.
- `npm run check` validates every serverless API file with Node.js.

## Layers

- Unit tests live in `tests/` and cover authentication helpers, input cleaning, frame limits, and review scheduling.
- API integration tests run against the deployed preview with a newly created anonymous Supabase user.
- Browser smoke tests cover the commercial homepage, `/app`, `/library`, mobile layout, and the recognition-to-review flow.

Name files `*.test.js`, use behavior-focused assertions, and restore any environment variable changed by a test.
