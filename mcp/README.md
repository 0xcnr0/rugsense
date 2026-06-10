# RugSense — MCP Server

Give any MCP client (Claude Desktop, Cursor, an agent framework) RugSense tools for
**pre-trade rug/honeypot risk on fresh Base tokens**. Each call pays per request via
**x402** (USDC on Base) using the wallet in `BUYER_PRIVATE_KEY` (funded on Base mainnet).

## Tools
- **`get_base_launches({ limit?, tier?, minSafety? })`** → ranked feed of freshly-launched Base
  tokens, scored (safety + momentum → `AVOID/WATCH/HOT`) with per-signal `checks[]`. $0.03.
  `limit` 1-50 (default 20) · `tier` HOT|WATCH|AVOID · `minSafety` 0-100.
- **`check_base_token({ address })`** → deep-score one token ("is this token safe?" before a
  swap), incl. Etherscan deployer reputation + serial-rugger history. $0.03. Invalid address /
  no-pool is not charged.
- **`check_base_tokens_batch({ addresses })`** → score up to 20 tokens at once (pre-screen a
  watchlist). $0.10. Charged only if at least one resolves.

## Install (published package — recommended)
Once published to npm, no clone needed:
```json
{
  "mcpServers": {
    "rugsense": {
      "command": "npx",
      "args": ["-y", "rugsense-mcp"],
      "env": { "BUYER_PRIVATE_KEY": "0xYOUR_FUNDED_BASE_WALLET_KEY" }
    }
  }
}
```
(Claude Desktop config: `~/Library/Application Support/Claude/claude_desktop_config.json`.)

Or via **Smithery** (one click, see `smithery.yaml` at the repo root): https://smithery.ai

## Install (from source — repo clone)
```json
{
  "mcpServers": {
    "rugsense": {
      "command": "npx",
      "args": ["-y", "tsx", "/ABSOLUTE/PATH/TO/mcp/server.ts"],
      "env": { "BUYER_PRIVATE_KEY": "0xYOUR_FUNDED_BASE_WALLET_KEY" }
    }
  }
}
```
Or run directly: `BUYER_PRIVATE_KEY=0x... npm run mcp`. Without the key the tools load but
return a `402` hint. `RADAR_URL` overrides the endpoint (defaults to https://rugsense.xyz).

## Publish to npm (maintainer)
```bash
cd mcp
npm install            # installs deps + typescript locally for the build
npm login              # your npm account
npm publish            # runs prepublishOnly → tsc build → publishes dist/
```
`npx rugsense-mcp` works immediately after. To list on Smithery, push the repo to GitHub
and submit it at smithery.ai (it reads `mcp/smithery.yaml`).
