# dockerfile-adversary

Working TypeScript Adversary that walks a workspace, finds Dockerfiles, and reports suspicious
`ENV` or `ARG` variables such as `SECRET`, `PASSWORD`, `TOKEN`, and `API_KEY`.

```bash
npm install
npm test
npm run build
npm start
```
