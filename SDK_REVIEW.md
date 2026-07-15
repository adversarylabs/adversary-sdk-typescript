# SDK engineering review

Date: 2026-07-10  
Reviewed version: `@adversarylabs/sdk@0.1.3`

> This document preserves the original 0.1.3 review. The 0.1.5 protocol correction supersedes its
> earlier wire-contract decisions: the package now emits only the strict CLI
> `adversary.review.v1` envelope, with flat canonical evidence and no nested result version field.

## Executive assessment

The SDK is usable today for first-party, Node 22+ ESM adversaries. A clean install from npm imports
successfully, its declarations compile in a fresh strict TypeScript consumer, it has no runtime
dependencies, and the core observe → group → synthesize → rank flow is understandable and well
tested.

I would still treat the current API as pre-stable. The main concern is not basic Node.js quality; it
is contract integrity. The published findings schema does not describe the object written at
runtime, several public options do not have the behavior their types imply, and rule definitions
are mutable process-global state. Those issues will surprise integrators more than any missing
feature would.

There is also one clear domain boundary crossing: Docker-specific review policy is embedded in the
generic SDK. The core knows about Dockerfiles, base-image digests, stages, builders, runtime
artifacts, and production wording. That language belongs in Docker rules, while the SDK should own
only collection, normalization, grouping, policy, and rendering.

My recommendation is to keep the current product direction, but do one contract-hardening pass
before inviting third-party adversary authors or declaring a stable v1 API.

## Implementation progress

| Review item | Status | Branch/PR | Notes |
| --- | --- | --- | --- |
| Wire schema mismatch | Complete | `sdk-strict-cli-protocol-0.1.5` | Exact CLI `adversary.review.v1` envelope and schema; protocol version 1 |
| Docker policy in core | Complete | `sdk/domain-boundary` | Generic synthesis now uses authored summaries, recommendations, and stable note keys only |
| Global rule registry | Complete | `sdk/instance-rule-registry` | Instance registries, duplicate rejection, explicit replacement, deprecated global compatibility |
| Evidence model and deduplication | Complete | `sdk-strict-cli-protocol-0.1.5` | Rich author inputs translate to flat CLI evidence and `metadata`; opt-out honored |
| Runtime API side effects | Complete | `sdk/runtime-api-separation` | Pure `run({ input })`; environment parsing and output writing live in `runFromEnvironment()` |
| Validation and result semantics | Complete | `sdk-strict-cli-protocol-0.1.5` | Complete envelopes validated before writes; scores translate to canonical notes |
| npm package hardening | Complete | `sdk/package-hardening` | Self-building tarball, clean JS/TS consumer test, metadata, license, usable maps, Node 22/24 CI |
| Starter template and tooling | Complete | `sdk/starter-template` | Visible SDK result, reproducible non-root container, lockfile, and vulnerability-free dev tooling |

## Bottom line

| Question | Assessment |
| --- | --- |
| Is it usable? | Yes, for controlled first-party use with a pinned `0.x` version. |
| Is the package installable? | Yes. `@adversarylabs/sdk@0.1.3` is on npm and passed fresh JavaScript and TypeScript consumer checks. |
| Does it follow Node.js SDK basics? | Mostly: ESM is explicit, `exports` is defined, NodeNext declarations work, strict TypeScript is enabled, and there are no runtime dependencies. |
| Is the public contract ready to stabilize? | Not yet. The wire schema, global registry, evidence model, and a few no-op/misleading fields need correction. |
| Has a boundary been crossed? | Yes. Docker-domain synthesis and terminology have leaked into the generic review engine. |

## What is already strong

- **Small consumer footprint.** The package has one production dependency, Ajv, to validate the
  exact shipped CLI schema before writing. The production-only npm audit is clean.
- **Modern module configuration.** ESM is explicit, TypeScript uses `NodeNext`, and the root and
  schema entry points are declared through `exports`. Node recommends `exports` for new packages
  because it defines and encapsulates the supported entry points.
- **Good TypeScript baseline.** `strict`, declarations, declaration maps, and consistent casing are
  enabled. A fresh strict TypeScript project resolved the installed declarations without special
  configuration.
- **Deterministic pipeline intent.** Grouping, evidence ordering, ranking, suppression, and output
  rendering have focused coverage. The process-boundary test is especially useful.
- **Good test seams.** Renderers accept write functions, runtime paths can be injected, and most
  behavior can be tested without patching globals.
- **Explicit ESM-only support.** The README says Node 22+ and ESM. There is no need to add a CommonJS
  build unless real consumers require one; a dual package would add complexity with little current
  benefit.
- **Published surface is compact.** One JavaScript entry point and two schema subpaths are easier to
  reason about than a large collection of deep imports.

## Priority 0: fix before treating the protocol as reliable

### 1. Align the published schema, manifest, and runtime envelope

**Status: Complete on `sdk-strict-cli-protocol-0.1.5`.** The run envelope and bundled schema are
byte-for-byte aligned with the CLI `adversary.review.v1` contract. Bundled manifests name that
format, protocol version 1 selects the contract, and the result has no separate version property.

The exported [`adversary.findings.v1` schema](./schemas/adversary.findings.v1.schema.json#L7)
requires this legacy shape:

```json
{
  "schema_version": "adversary.findings.v1",
  "adversary": "...",
  "summary": {},
  "findings": []
}
```

The runtime actually writes an [`AdversaryRunEnvelope`](./src/index.ts#L233) containing
`protocolVersion` and `result`, and the README documents that newer shape. Meanwhile both bundled
`adversary.yaml` files still declare `findings.format: adversary.findings.v1`.

This is the most serious issue in the repository. A consumer can import the officially exported
schema, validate actual SDK output, and correctly conclude that the output is invalid.

Recommended change:

1. Decide which object is the real wire contract: the run envelope or the legacy findings object.
2. Publish a schema whose name and version match that exact object, including nested
   `ReviewResult`/`ReviewFinding` definitions.
3. Update both bundled manifests to name the same format.
4. Add a contract test that runs an adversary, writes the output, and validates it against the
   schema shipped in the npm tarball.
5. Treat later schema changes as protocol changes, independently from SDK implementation changes.

Do not leave two plausible contracts in the same package.

### 2. Move Docker knowledge out of the generic engine

**Status: Complete on `sdk/domain-boundary`.** Dockerfile detection, digest/stage handling,
Docker-specific opinion subjects, tag-based runtime ranking, and the fixed domain vocabulary were
removed. Review-note deduplication now uses stable keys or exact normalized identity; domain rules
remain responsible for their presentation language.

The generic synthesis layer currently contains all of the following:

- Dockerfile detection and Docker-specific assessment/opinion subjects
  ([`assessmentStrength` and `findingsReferenceDockerfile`](./src/index.ts#L1034)).
- Special handling for digest pinning and mutable base-image tags
  ([`assessmentConcern`](./src/index.ts#L1053)).
- Stage extraction and `{stage}`/`{stages}` template values
  ([`extractStage`](./src/index.ts#L1305)).
- A digest-pinning recommendation label ([`recommendationSubject`](./src/index.ts#L1365)).
- Positive-signal vocabulary limited to artifact/builder/digest/runtime/stage concepts
  ([`highSignalReviewTerms`](./src/index.ts#L1821)).

That is a real boundary crossing. It makes Docker output polished, but every future domain must
either accept generic prose or add more domain branches to `src/index.ts`.

Recommended change:

- Keep generic synthesis conservative and grammatical.
- Put domain wording in `RuleDefinition.aggregate` or explicit rule-owned presentation metadata.
- Let a Docker rule provide labels such as `Digest pinning`, evidence labels such as `deps stage`,
  and any Dockerfile-specific overall assessment.
- Replace hard-coded semantic deduplication vocabulary with stable note keys or rule-provided
  equivalence keys.

The SDK should decide **how** a review is assembled. Rules should decide **what domain facts mean**.

## Priority 1: make the public API tell the truth

### 3. Remove process-global mutable rule behavior

**Status: Complete on `sdk/instance-rule-registry`.** `app.defineRule(...)` and
`app.replaceRule(...)` own defensively copied definitions per instance, runs use a registry
snapshot, and duplicate definition/app-rule IDs throw. The top-level registry remains only as a
deprecated compatibility bridge and cannot overwrite definitions silently.

[`defineRule`](./src/index.ts#L318) writes into a module-global registry, registration silently
overwrites an existing ID, and all `Adversary` instances consult that global registry at run time.
A rule defined for one app/test/plugin can therefore change another app's output.

This was reproduced during review: registering `collision` twice and then running the first app
made it use the second definition.

Recommended change:

- Make rule definitions instance-scoped (`app.defineRule(...)`) or inject a registry into
  `Adversary`.
- Reject duplicate IDs by default. Require an explicit replacement operation when replacement is
  intentional.
- Store defensive copies and expose read-only views.
- If the top-level `defineRule` API must remain temporarily, make its compatibility/global-state
  behavior explicit and deprecate it before v1.

Related: [`Adversary.rules`](./src/index.ts#L347) is publicly mutable, and `reviewPolicy` retains the
caller's mutable object. Both should be private/read-only snapshots.

### 4. Fix or remove `FindingInput.deduplicate`

**Status: Complete on `sdk/evidence-model`.** Direct findings can opt out of merging, receive
stable distinct IDs, and retain their authored summaries and recommendations.

[`FindingInput`](./src/index.ts#L133) advertises `deduplicate?: boolean`, but normalization drops the
field and [`deduplicateFindings`](./src/index.ts#L882) always merges matching IDs/group keys.

This was also reproduced: two direct findings with `deduplicate: false` became one finding with two
evidence entries. Silent merging can discard the second summary, impact, recommendation, or
metadata.

Recommended change: either implement the flag for direct findings or remove it from
`FindingInput`. Add a regression test with two same-title findings and different recommendations,
not only different evidence.

### 5. Choose one canonical evidence-location model

**Status: Complete on `sdk-strict-cli-protocol-0.1.5`.** Authoring retains rich nested locations,
labels, and data. Wire serialization translates them to flat location fields, message, and
metadata, and never emits the internal authoring shape.

[`Evidence`](./src/index.ts#L67) permits both:

```ts
{ file, line, endLine }
```

and:

```ts
{ location: { file, line, endLine } }
```

Observation conversion writes both forms and also duplicates the same raw evidence under `data`
and `metadata` ([`observationToEvidence`](./src/index.ts#L1138)). Sorting and some renderer paths use
the top-level fields, while other code falls back to the nested form.

Recommended change:

- Introduce one `Location` type.
- Normalize once at the collection boundary.
- Keep one structured payload field (`data` or `metadata`, not both).
- Render and sort exclusively from the normalized form.
- Provide a compatibility normalizer for old input during the `0.x` period if needed.

### 6. Separate the library call from the container/CLI runtime side effects

**Status: Complete on `sdk/runtime-api-separation`.** Programmatic execution requires explicit
input and has no ambient path overrides or file writes. `runFromEnvironment()` owns CLI/container
environment parsing, envelope creation, and output writing; explicit adapter options win.

[`app.run()`](./src/index.ts#L368) reads ambient environment variables, lets
`ADVERSARY_REPO` override an explicitly supplied input path, and writes to
`/adversary/output.json` unless callers remember `write: false`.

That behavior is convenient for the container entry point but surprising for a method exposed as a
normal SDK API. Explicit arguments should normally outrank ambient process state, and a library
method should not write an absolute system path by default.

Recommended change:

- Keep a programmatic `run({ input, ... })` path with no implicit write and explicit options taking
  precedence.
- Add a narrow `runFromEnvironment()`/runtime adapter that owns env parsing and default file I/O.
- Keep `createAdversaryRunEnvelope` and transport writing in that adapter.

This can be introduced compatibly first and made the default behavior at the next intentional
breaking version.

### 7. Validate the complete public model at runtime

**Status: Complete on `sdk/model-validation`.** Policies are validated before execution, and final
aggregate findings, evidence, remediation complexity, severity overrides, and score bounds are
checked with actionable adversary/rule context.

Current checks catch several useful author errors, but important values are not validated:

- `ReviewPolicy.maximumFindings` and confidence-threshold ordering/ranges.
- `severityOverrides` values.
- `Remediation.complexity`.
- Nested `Evidence.location`, `data`, and `metadata`.
- Aggregate results returned from `RuleDefinition.aggregate`.
- Finite/non-negative score values and a positive maximum.
- Duplicate app rule IDs.

TypeScript is not a runtime boundary, and this SDK is explicitly converting authored code into a
wire object. Validate once after aggregation and before ranking/output. Errors should include the
app rule ID and observation rule ID so authors can act on them.

### 8. Make result fields meaningful or remove them

**Status: Complete on `sdk-strict-cli-protocol-0.1.5`.** Summary exposes only `files_scanned`,
duplicate observations are counted in the CLI-required suppression field, and nondeterministic
timing is emitted only when `includeTiming` is explicitly enabled.

- [`ctx.summary`](./src/index.ts#L245) accepts arbitrary fields, but only `files_scanned` is copied
  into `ReviewResult`.
- `suppressed.observations` is always `0` ([result construction](./src/index.ts#L774)), even though
  observations are deduplicated and transformed.
- `timing.totalMs` is always included, making otherwise equivalent JSON differ from run to run.
- A multi-finding opinion may have `ship: true` while saying all remaining findings should be
  addressed before production.

Recommended change: define the semantics of each field, test them, and remove fields that do not
carry reliable information. Put diagnostic timing behind an explicit option if deterministic JSON
is a product goal.

## Priority 2: finish the npm package

### 9. Make packing self-contained and test the tarball

**Status: Complete on `sdk/package-hardening`.** `prepack` builds from source and the consumer smoke
test installs the real tarball, imports JavaScript, compiles strict TypeScript, and resolves both
schema exports.

The package has no `prepack`/`prepare` script. CI happens to build immediately before publish, but a
local `npm pack` or `npm publish` from a clean checkout can produce a package without `dist`.

Recommended change:

```json
{
  "scripts": {
    "prepack": "npm run build"
  }
}
```

Then add a CI smoke test that:

1. Runs `npm pack` into a temporary directory.
2. Installs that tarball into a fresh consumer project.
3. Imports the JavaScript entry point.
4. Compiles a strict TypeScript consumer.
5. Resolves and validates both schema subpath exports.

npm explicitly recommends inspecting package contents with `npm pack --dry-run`; testing the
actual tarball catches issues that local `dist` imports cannot.

### 10. Fix source/declaration maps

**Status: Complete on `sdk/package-hardening`.** Published source and declaration maps embed their
source text with `inlineSources`.

The tarball includes `index.js.map` and `index.d.ts.map`, both pointing to `../src/index.ts`, but
`src/` is excluded from `files` and neither map embeds `sourcesContent`. Editors and debuggers cannot
follow those maps back to the source they name.

Choose one:

- Include `src/` in the tarball.
- Enable `inlineSources` so maps contain source text.
- Stop publishing maps if source navigation is not desired.

TypeScript describes declaration maps as a way for editors to navigate back to original `.ts`
sources; the original source must therefore be available somehow.

### 11. Add normal package metadata and the license text

**Status: Complete on `sdk/package-hardening`.** The package includes the MIT license, repository,
homepage, issue tracker, and public/provenance publish metadata.

`package.json` has a good SPDX `license` value, but the repository/tarball has no `LICENSE` file and
the package lacks `repository`, `homepage`, and `bugs` fields.

Add:

- A top-level MIT `LICENSE` file.
- Full repository metadata.
- Issue tracker and homepage URLs.
- `publishConfig.access: "public"` to encode the intended scoped-package visibility.

These fields improve npm discoverability, provenance linking, legal clarity, and the consumer's
path from an error to the source repository.

### 12. Test every supported Node line

**Status: Complete on `sdk/package-hardening`.** Pull requests execute the complete suite on Node
22 and Node 24.

The package declares `node >=22`, but CI only executes Node 22. Node 24 is the current LTS line as
of this review, while Node 22 remains LTS. Test at least the minimum supported major and current LTS
(22 and 24). Optionally test the current release line without making it blocking immediately.

The existing `NodeNext`/ES2022 configuration is appropriate for this support policy.

### 13. Repair the bundled starter experience

**Status: Complete on `sdk/starter-template`.** The starter visibly emits its demonstration result,
ships a shrinkwrap and `.dockerignore`, uses `npm ci`, and builds a small non-root runtime stage.

The basic template's only finding is informational ([template source](./templates/basic/src/index.ts#L8)),
but default policy suppresses informational findings. Running the generated adversary normally can
therefore produce zero findings even though its purpose is to prove the SDK works; only its test
overrides the policy.

Also address these template concerns:

- Make the starter finding visible by default or make the template a no-finding success example.
- Update the manifest format after resolving the schema/wire-contract issue.
- Include a lockfile and use `npm ci` in the Docker build, or clearly present it as development-only.
- Add a `.dockerignore`; otherwise `COPY . .` can copy local build artifacts and `node_modules`.
- Consider a multi-stage, non-root runtime image for a production-oriented template.

## Priority 3: operational and maintainability improvements

### 14. Update vulnerable development tooling

**Status: Complete on `sdk/starter-template`.** Vitest 4 replaces the vulnerable Vitest 2/Vite
chain; the full dependency audit reports zero vulnerabilities.

The package has no vulnerable production dependencies (`npm audit --omit=dev` reported zero), which
is excellent. The full audit currently reports five development-chain advisories, including a
critical Vitest advisory because the repository still uses Vitest 2.1.8.

Upgrade Vitest and its Vite/esbuild chain, then keep dependency updates automated. The vulnerable
UI/server path is not exercised by `vitest run`, so this is development/CI hygiene rather than a
consumer runtime vulnerability.

### 15. Harden publishing credentials and provenance

Publishing currently uses a stored `NPM_TOKEN`. Prefer npm trusted publishing with OIDC when
Depot can provide a supported cloud-runner identity. npm recommends trusted publishing over tokens
and automatically creates provenance for supported public-package workflows. If Depot is not yet a
supported npm trusted publisher, keep the granular token narrowly scoped, short-lived, and rotated.

Also consider a release tool or script that updates the version, formats, validates, packs, commits,
and tags in one order. The current manual sequence already produced tag/version and formatting
failures during the first release attempts.

### 16. Improve error context and cancellation

One thrown rule error currently aborts the run without identifying the registered app rule, and
long repository scans cannot be cancelled.

Recommended change:

- Wrap failures with the app rule ID while preserving the original `cause`.
- Add `signal?: AbortSignal` to `RunOptions` and check it between rules and during directory walks.
- Decide explicitly whether one failed rule aborts the run or becomes a structured run failure.

### 17. Revisit the custom glob walker before scaling

The current walker is dependency-free and adequate for small repositories, but it recursively
visits every directory, has no ignore model, and implements only a subset of common glob syntax.
Large repositories can spend most scan time under `.git`, `node_modules`, generated outputs, or
vendor trees.

Document the supported pattern grammar now. Before scaling, add default ignores plus caller
overrides, cancellation, and bounded traversal. Do not silently present this helper as a complete
glob implementation.

### 18. Split internal modules without expanding the public surface

`src/index.ts` is about 1,900 lines and currently contains public types, file walking, validation,
registry state, synthesis, ranking, and two renderers. This is not a consumer problem, but it makes
boundary mistakes easier to introduce.

Split internal implementation by responsibility while keeping the same single public entry point:

```text
src/
  index.ts              public exports only
  runtime.ts            env/file adapter
  model.ts              public model
  registry.ts
  pipeline.ts
  validation.ts
  renderers/
```

Node's `exports` map can continue exposing only the supported root and schema paths, so an internal
split does not need to become a public API expansion.

## Suggested order of work

1. Resolve and test the wire schema/manifest contract.
2. Move Docker-specific synthesis out of the core.
3. Make rule registration instance-scoped and reject collisions.
4. Fix `FindingInput.deduplicate` and normalize evidence to one shape.
5. Separate programmatic execution from env/file runtime behavior.
6. Add complete runtime validation and correct misleading result fields.
7. Add `prepack` plus a packed-consumer CI test.
8. Add license/package metadata, fix maps, and test Node 22 + 24.
9. Repair the starter template and upgrade development tooling.
10. Improve release identity/provenance, cancellation, and internal organization.

I would avoid adding new review features until items 1–6 are settled. They define the contract that
future features would otherwise have to preserve.

## Verification performed

- `npm test`: 30 tests passed.
- `npm run lint`: passed.
- `npm pack --dry-run --json`: 15 files, approximately 137 KB unpacked.
- Fresh npm install of `@adversarylabs/sdk@0.1.3`: ESM import passed.
- Fresh strict TypeScript consumer using `module: NodeNext`: type-check passed.
- Published schema subpath resolution: passed, but exposed the schema/runtime mismatch above.
- Targeted direct-finding probe: confirmed `deduplicate: false` is ignored.
- Targeted registry probe: confirmed a later global definition silently changes an earlier app.
- `npm audit --omit=dev`: zero vulnerabilities.
- Full `npm audit`: five development dependency findings (three moderate, one high, one critical).

## References

- [Node.js package entry points and `exports`](https://nodejs.org/api/packages.html)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [npm `package.json` documentation](https://docs.npmjs.com/files/package.json/)
- [npm package lifecycle scripts](https://docs.npmjs.com/cli/using-npm/scripts/)
- [npm publish and tarball inspection](https://docs.npmjs.com/cli/publish/)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [TypeScript declaration-map guidance](https://www.typescriptlang.org/tsconfig/declarationMap.html)
- [Vitest advisory GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)
