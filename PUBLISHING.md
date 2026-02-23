# Publishing Guide

## npm (TypeScript package)

### First-time setup
```bash
npm adduser          # Create account or login
npm whoami           # Verify logged in
```

### Publish
```bash
npm run build        # Build dist/
npm test             # Verify tests pass
npm publish          # Publish to npm registry
```

### After publishing
Users can install with:
```bash
npx codecks-mcp                    # Run directly
npm install -g codecks-mcp         # Install globally
```

## MCP Registry Submission

After publishing to npm, submit to the MCP registry:
1. Fork https://github.com/modelcontextprotocol/servers
2. Add `server.json` entry pointing to the npm package
3. Open a PR

## Version Bumps
```bash
npm version patch    # 0.1.0 -> 0.1.1
npm version minor    # 0.1.0 -> 0.2.0
npm version major    # 0.1.0 -> 1.0.0
git push --tags
npm publish
```
