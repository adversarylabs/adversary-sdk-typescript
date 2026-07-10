# basic-adversary

Minimal TypeScript Adversary built with `@adversarylabs/sdk`.

```bash
npm ci
npm test
npm run build
npm start
```

At runtime the adversary reads `/adversary/input.json` and writes `/adversary/output.json`.
The included informational finding is intentionally visible so a clean run demonstrates the full
SDK path; replace it with your own rules before publishing.
