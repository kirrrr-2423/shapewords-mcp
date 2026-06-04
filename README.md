# ShapeWords MCP

Universal MCP server for generating word clouds with [ShapeWords](https://shapewords.fun/).

It exposes ShapeWords Render API tools through the Model Context Protocol, so any MCP-capable client can create SVG, JSON, or PNG word clouds from text, workshop notes, prompts, research snippets, or agent output.

## Tools

### `render_word_cloud`

Creates a ShapeWords render job, polls until it is finished, and returns:

- public artifact URL;
- job metadata;
- optional image content for MCP clients that support image results.

### `create_word_cloud_job`

Starts a render job and returns the job/status/artifact URLs without waiting.

### `get_word_cloud_job`

Checks a render job by ID.

## Quick Start

Run directly from GitHub:

```bash
npx -y github:kirrrr-2423/shapewords-mcp
```

Or clone locally:

```bash
git clone https://github.com/kirrrr-2423/shapewords-mcp.git
cd shapewords-mcp
npm install
npm start
```

## Client Configuration

Use stdio transport in any MCP-compatible client.

```json
{
  "mcpServers": {
    "shapewords": {
      "command": "npx",
      "args": ["-y", "github:kirrrr-2423/shapewords-mcp"],
      "env": {
        "SHAPEWORDS_API_BASE_URL": "https://shapewords.fun"
      }
    }
  }
}
```

For a local clone:

```json
{
  "mcpServers": {
    "shapewords": {
      "command": "node",
      "args": ["/absolute/path/to/shapewords-mcp/src/index.js"],
      "env": {
        "SHAPEWORDS_API_BASE_URL": "https://shapewords.fun"
      }
    }
  }
}
```

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `SHAPEWORDS_API_BASE_URL` | `https://shapewords.fun` | ShapeWords app URL. |
| `SHAPEWORDS_RENDER_API_KEY` | empty | Optional bearer token if your Render API requires one. |
| `SHAPEWORDS_POLL_INTERVAL_MS` | `1500` | Polling interval for completed renders. |
| `SHAPEWORDS_POLL_TIMEOUT_MS` | `90000` | Render wait timeout. |
| `SHAPEWORDS_MAX_IMAGE_BYTES` | `8388608` | Max downloaded artifact size when `returnImage` is true. |

## Example Prompt

```text
Create a fast SVG word cloud about MCP, universal tools, word cloud generation, AI agents, and ShapeWords. Use a circle shape and return the artifact URL.
```

Example tool input:

```json
{
  "text": "MCP MCP MCP Model Context Protocol word cloud word cloud ShapeWords tools resources prompts stdio server client universal integration connector API render PNG SVG artifact agents automation context protocol schema",
  "locale": "en",
  "format": "svg",
  "width": 1024,
  "height": 640,
  "background": "white",
  "quality": "sq",
  "engine": "auto",
  "returnLayout": true,
  "shapeType": "circle",
  "palette": ["#7c3aed", "#ddd6fe", "#14b8a6", "#111827"],
  "returnImage": false
}
```

## Development

```bash
npm install
npm run inspect
```

The server uses stdio and writes protocol messages to stdout. Diagnostics are written to stderr.

## Notes

- Generated artifact URLs are short-lived because the ShapeWords Render API keeps jobs in memory.
- Set `returnImage: true` in `render_word_cloud` when the MCP client supports image content and needs the bytes inline.
- The default path is SVG/browserless for lower latency. PNG uses the browser fallback until server-side rasterization is available.
- For automation-heavy use, prefer SVG or JSON layout artifacts; request PNG only when the caller needs raster pixels.
