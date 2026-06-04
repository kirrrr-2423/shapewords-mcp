# ShapeWords MCP

Universal MCP server for generating word clouds with [ShapeWords](https://shapewords.fun/).

It exposes ShapeWords Render API tools through the Model Context Protocol, so any MCP-capable client can create SVG, JSON, or PNG word clouds from text, workshop notes, prompts, research snippets, or agent output.

## Tools

All tools use stdio MCP transport.

### `render_word_cloud`

Creates a ShapeWords render job, polls until it is finished, and returns:

- public artifact URL;
- job metadata;
- optional image content for MCP clients that support image results.

Use this tool for one-shot generation when the caller wants the final artifact.

### `create_word_cloud_job`

Starts a render job and returns the job/status/artifact URLs without waiting.

Use this tool for asynchronous workflows where the client will poll later.

### `get_word_cloud_job`

Checks a render job by ID.

Use this tool with the `jobId` returned by `create_word_cloud_job` or `render_word_cloud`.

## Input Schema

`render_word_cloud` and `create_word_cloud_job` accept the same render options. `render_word_cloud` also accepts polling and inline-image options.

| Field | Type | Default | Limits | Description |
| --- | --- | --- | --- | --- |
| `text` | string | required | 1-100,000 chars | Source text for the word cloud. Can be prose, notes, prompts, repeated words, keyword lists, or agent output. |
| `locale` | enum | `en` | `en`, `ru`, `ar`, `es`, `fr`, `zh` | Render/UI locale passed to ShapeWords. |
| `format` | enum | `svg` | `svg`, `png`, `json` | Artifact format. SVG is the fastest default. JSON returns layout data. PNG uses the browser renderer. |
| `width` | integer | `1024` | 240-4096 | Canvas width in pixels. |
| `height` | integer | `640` | 240-4096 | Canvas height in pixels. |
| `background` | enum | `white` | `transparent`, `white`, `dark` | Output background. |
| `quality` | enum | `sq` | `sq`, `hq` | Standard or high-quality render. `hq` is slower. |
| `engine` | enum | `auto` | `auto`, `browser`, `browserless` | Renderer engine. `auto` uses browserless for SVG/JSON when possible and browser for PNG. |
| `returnLayout` | boolean | `true` | true/false | Ask the Render API to include layout metadata when supported. |
| `shapeType` | string | `circle` | 1-80 chars | Shape id. Use a built-in id or `custom` with `customShapeDefinition`. |
| `customShapeDefinition` | object | omitted | see below | Custom SVG path shape. Required when `shapeType` is `custom`. |
| `maxWords` | integer | `120` | 1-1000 | Maximum number of words to place. |
| `fontFamily` | string | service default | 1-80 chars | Optional ShapeWords font family name, for example `Inter`, `Roboto`, `Montserrat`, `Noto Sans`. |
| `minFontSize` | integer | service default | 4-400 | Minimum word font size. |
| `maxFontSize` | integer | service default | 8-700 | Maximum word font size. |
| `palette` | string[] | service default | up to 12 colors | Hex colors: `#rgb`, `#rrggbb`, or `#rrggbbaa`. |
| `colorMode` | enum | service default | `sequential`, `random`, `byFrequency` | How palette colors are assigned to words. |
| `returnImage` | boolean | `false` | `render_word_cloud` only | Download the finished SVG/PNG artifact and return it as MCP image content. |
| `pollIntervalMs` | integer | env/default | 250-10,000 | Polling interval for `render_word_cloud`. |
| `pollTimeoutMs` | integer | env/default | 1,000-180,000 | Maximum wait time for `render_word_cloud`. |

`get_word_cloud_job` accepts:

| Field | Type | Limits | Description |
| --- | --- | --- | --- |
| `jobId` | string | 6-64 chars | ShapeWords render job id. |

## Text Input

The MCP server sends `text` to ShapeWords as raw source text:

- repeated words increase frequency, for example `cloud cloud cloud render render API`;
- paragraphs, meeting notes, workshop notes, prompts, research snippets, and keyword lists are valid;
- explicit weighted word arrays are not part of the current MCP schema, so repeat words when you need stronger weighting;
- files such as CSV, Excel, or Google Sheets are not uploaded through this MCP server; paste or generate the text content first.

Example weighted text:

```json
{
  "text": "MCP MCP MCP ShapeWords ShapeWords word cloud word cloud render API agents tools",
  "shapeType": "cloud",
  "format": "svg"
}
```

## Shapes

Use `shapeType` to choose the word-cloud mask.

Stable built-in shape ids accepted by the production renderer include:

```text
rectangle, circle, heart, star, cloud, diamond, tree, triangle, arrow,
square, pentagon, hexagon, octagon, cross, plus, moon, sun, drop,
flame, leaf, flower, mountain, apple, house, book, camera, music,
chat, location, trophy, rocket, plane, car, shield, lightning, check,
infinity, tag
```

Built-in brand shape ids include:

```text
brand-product-hunt, brand-y-combinator, brand-hacker-news,
brand-indie-hackers, brand-github, brand-figma, brand-notion,
brand-stripe, brand-vercel, brand-linear, brand-supabase,
brand-railway, brand-netlify, brand-firebase, brand-cloudflare,
brand-airtable, brand-replit, brand-anthropic
```

The production renderer may also accept additional generated ShapeWords ids. For portable automation, prefer the stable ids above or pass a custom SVG shape.

### Custom Shapes

Set `shapeType` to `custom` and provide `customShapeDefinition`:

| Field | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `path` | string | yes | 1-100,000 chars | SVG path data used as the mask. |
| `viewBox` | string | yes | 1-120 chars | SVG viewBox, for example `0 0 100 100`. |
| `fillRule` | enum | no | `nonzero`, `evenodd` | SVG fill rule. Defaults to renderer behavior when omitted. |
| `name` | string | no | 1-80 chars | Optional human-readable name. |
| `nameEn` | string | no | 1-80 chars | Optional English name. |

Custom heart example:

```json
{
  "text": "love love design care product community team support",
  "shapeType": "custom",
  "customShapeDefinition": {
    "name": "Heart",
    "path": "M 50 90 C 25 70, 0 50, 0 30 A 25 25 0 0 1 50 30 A 25 25 0 0 1 100 30 C 100 50, 75 70, 50 90 Z",
    "viewBox": "0 0 100 100",
    "fillRule": "nonzero"
  },
  "format": "svg"
}
```

## Output

`render_word_cloud` returns:

- text content with the completed job id and artifact URL;
- `structuredContent.job` with normalized job metadata;
- `structuredContent.artifactUrl`;
- `structuredContent.siteUrl`;
- optional MCP image content when `returnImage` is `true` and `format` is `svg` or `png`.

`create_word_cloud_job` returns the same metadata immediately after job creation, without waiting for completion.

`get_word_cloud_job` returns the latest job status and artifact URL.

Generated artifact URLs are short-lived because the ShapeWords Render API stores render jobs in memory.

## Format and Engine Notes

- `svg` is the recommended automation format: it is fast, compact, and works with the browserless renderer.
- `json` returns layout data and is supported by the browserless renderer.
- `png` requires the browser renderer.
- `engine: "auto"` is recommended unless you need to force a specific path.
- `engine: "browserless"` supports `svg` and `json`, not `png`.
- `engine: "browser"` supports `svg` and `png`, not `json`.

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
| `SHAPEWORDS_API_KEY` | empty | Backward-compatible alias for `SHAPEWORDS_RENDER_API_KEY`. |
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

## More Examples

### Transparent PNG

```json
{
  "text": "launch launch startup product customers retention growth metrics roadmap",
  "format": "png",
  "engine": "auto",
  "shapeType": "rocket",
  "width": 1200,
  "height": 900,
  "background": "transparent",
  "quality": "hq",
  "returnImage": true
}
```

### JSON Layout

```json
{
  "text": "design system tokens components variants accessibility contrast typography layout",
  "format": "json",
  "engine": "browserless",
  "shapeType": "diamond",
  "returnLayout": true,
  "maxWords": 80
}
```

### Custom Palette and Font

```json
{
  "text": "research synthesis interview persona journey insight opportunity experiment",
  "format": "svg",
  "shapeType": "book",
  "fontFamily": "Roboto",
  "palette": ["#111827", "#2563eb", "#14b8a6", "#f59e0b"],
  "colorMode": "byFrequency",
  "maxWords": 160
}
```

## Development

```bash
npm install
npm run inspect
```

The server uses stdio and writes protocol messages to stdout. Diagnostics are written to stderr.

## Notes

- Set `returnImage: true` in `render_word_cloud` when the MCP client supports image content and needs the bytes inline.
- For automation-heavy use, prefer SVG or JSON layout artifacts; request PNG only when the caller needs raster pixels.
- The MCP schema currently exposes rendering and style options only. It does not expose ShapeWords UI-only workflows such as the advanced word editor, 2D/3D view switching, CSV/Excel upload, Google Sheets import, or live room controls.
- Lower-level Render API knobs such as `padding`, `rotationPreset`, `rotations`, `spiralType`, and `fillMode` are not currently exposed by this MCP tool schema.
