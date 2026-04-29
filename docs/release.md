# Release Checklist

Eventloom runtime publishes as `@eventloom/runtime`.

## Preflight

```bash
npm test
npm run build
npm_config_cache=/tmp/threadline-npm-cache npm pack --dry-run
```

The package should include only:

- `dist/`
- `README.md`
- `LICENSE`
- selected user-facing docs
- `fixtures/sample.jsonl`
- `package.json`

## Local Tarball Smoke Test

```bash
npm_config_cache=/tmp/threadline-npm-cache npm pack
mkdir -p /tmp/threadline-consumer
cd /tmp/threadline-consumer
npm init -y
npm install /path/to/threadline/eventloom-runtime-0.1.0.tgz
node --input-type=module -e "import { createRuntime } from '@eventloom/runtime'; console.log(typeof createRuntime)"
npx threadline replay /path/to/threadline/fixtures/sample.jsonl
```

## Publish

For the first public scoped publish:

```bash
npm publish --access public
```

For later releases:

```bash
npm version patch
npm publish
git push origin master --tags
```

## Notes

- `prepack` runs tests and build before packing or publishing.
- `@eventloom/runtime` is ESM-only.
- Node.js `>=20` is required.
- Do not publish from a dirty worktree.
