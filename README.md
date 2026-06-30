# adversary-sdk-typescript

Small TypeScript SDK for building Adversaries.

The SDK is intentionally tiny. The CLI owns execution. The SDK owns developer ergonomics:
read `/adversary/input.json`, inspect the workspace, and emit findings to
`/adversary/output.json`.

## Install

```bash
npm install @adversarylabs/sdk
```

Requires Node 22 or newer and ESM.

## Author an adversary

```ts
import { defineAdversary, finding } from "@adversarylabs/sdk";

export default defineAdversary(async ({ report }) => {
  report(
    finding({
      id: "DOCKER-001",
      severity: "high",
      title: "Potential secret found",
      file: "Dockerfile",
      line: 14,
      evidence: "ENV API_KEY=...",
      recommendation: "Use runtime secrets instead."
    })
  );
});
```

## API

### defineAdversary(handler)

Defines an adversary handler. The returned object has `run(input?)`, which collects reported
findings and returns an `Output` object.

```ts
const adversary = defineAdversary(async ({ workspace, input, change, report }) => {
  report(finding({ id: "EXAMPLE-001", severity: "low", title: "Example" }));
});

await adversary.run();
```

### finding(value)

Creates a typed `Finding`.

### parseInput(path?)

Reads and validates `/adversary/input.json` by default.

### reportFinding(finding, path?)

Appends a finding to `/adversary/output.json` by default.

### writeOutput(output, path?)

Writes an `Output` object to `/adversary/output.json` by default.

## Runtime contract

Input is read from:

```text
/adversary/input.json
```

Output is written to:

```text
/adversary/output.json
```

The SDK exports TypeScript types for `Input`, `ChangeContext`, `Finding`, `Severity`, and
`Output`. JSON schemas are published at:

- `@adversarylabs/sdk/schemas/adversary.input.v1`
- `@adversarylabs/sdk/schemas/adversary.findings.v1`

## Development

```bash
npm install
npm test
npm run build
npm run lint
```

## Repository layout

```text
src/                         SDK source
schemas/                     Runtime JSON schemas
templates/basic/             Starter adversary project
examples/dockerfile-adversary/ Working example adversary
test/                        SDK tests
scripts/                     Contributor scripts
```
