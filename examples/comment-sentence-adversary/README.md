# comment-sentence-adversary

Working TypeScript Adversary that walks a workspace, finds TypeScript line comments, and reports
comments that are written as complete sentences.

## Automatic detection

`adversary auto` selects this example when TypeScript files change, using the declarative
`detection.files` patterns in `adversary.yaml`.

```bash
npm install
npm test
npm run build
npm start
```
