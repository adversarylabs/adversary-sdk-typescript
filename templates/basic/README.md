# basic-adversary

Minimal TypeScript Adversary built with `@adversarylabs/sdk`.

## Automatic detection

`adversary auto` selects this starter when TypeScript files change. Adjust `detection.files` in
`adversary.yaml` to match the technology or domain your adversary reviews.

```bash
npm ci
npm test
npm run build
npm start
```

At runtime the adversary reads `/adversary/input.json` and writes `/adversary/output.json`.
The included informational finding is intentionally visible so a clean run demonstrates the full
SDK path; replace it with your own rules before publishing.
