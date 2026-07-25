# Project guidance

## Testing

Run `npm run check && npm test` before committing. Tests live in `tests/`; see `TESTING.md`.

Aim for full coverage of business logic. Add a test with every new function, every bug fix, every error path, and both sides of new conditionals. Never commit changes that make existing tests fail.
