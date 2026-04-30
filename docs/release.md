# Release Checklist

Eventloom runtime publishes as `@eventloom/runtime`. The MCP server publishes separately from `packages/mcp` as `@eventloom/mcp`.

## Preflight

```bash
npm test
npm run build
npm_config_cache=/tmp/eventloom-npm-cache npm pack --dry-run
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
npm_config_cache=/tmp/eventloom-npm-cache npm pack
mkdir -p /tmp/eventloom-consumer
cd /tmp/eventloom-consumer
npm init -y
npm install /path/to/eventloom/eventloom-runtime-0.1.5.tgz
node --input-type=module -e "import { createRuntime } from '@eventloom/runtime'; console.log(typeof createRuntime)"
npx eventloom replay /path/to/eventloom/fixtures/sample.jsonl
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

For MCP package releases:

```bash
cd packages/mcp
npm test
npm run build
npm pack --dry-run
npm publish --access public
```

## Notes

- `prepack` runs tests and build before packing or publishing.
- `@eventloom/runtime` is ESM-only.
- `@eventloom/mcp` is ESM-only and depends on a published `@eventloom/runtime` version.
- Node.js `>=20` is required.
- Do not publish from a dirty worktree.
