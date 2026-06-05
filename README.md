# ShapeWords MCP

Universal MCP server for generating word clouds with [ShapeWords](https://shapewords.fun/).

It exposes ShapeWords rendering tools through the Model Context Protocol, so any MCP-capable client can create SVG, JSON, or PNG word clouds from text, workshop notes, prompts, research snippets, or agent output. By default it uses the hosted ShapeWords Render API; with `engine: "skia"` it renders locally inside the MCP server with the shared layout core and CanvasKit/Skia.

## Tools

All tools use stdio MCP transport.

### `render_word_cloud`

Creates a ShapeWords render job, polls until it is finished, and returns:

- public artifact URL for hosted renders, or a local inline artifact for `engine: "skia"`;
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

`render_word_cloud` accepts all render options below. `create_word_cloud_job` accepts the hosted options only: `engine: "skia"` is local-only and is supported by `render_word_cloud`.

| Field | Type | Default | Limits | Description |
| --- | --- | --- | --- | --- |
| `renderProfile` | enum | `canvas` | `canvas`, `api` | Default option profile. `canvas` matches the main ShapeWords canvas; `api` keeps the older compact Render API defaults. |
| `text` | string | optional | 1-100,000 chars | Source text for the word cloud. Required unless `words` is provided. |
| `words` | object[] | optional | 1-1000 items | Explicit weighted words. Use when the caller already tokenized, lemmatized, or scored text. |
| `locale` | enum | `en` | `en`, `ru`, `ar`, `es`, `fr`, `zh` | Render/UI locale passed to ShapeWords. |
| `format` | enum | `svg` | `svg`, `png`, `json` | Artifact format. SVG is the fastest default. JSON returns layout data. PNG is rasterized from the same shared layout. |
| `width` | integer | `800` | 240-4096 | Canvas width in pixels. |
| `height` | integer | `600` | 240-4096 | Canvas height in pixels. |
| `background` | enum | `white` | `transparent`, `white`, `dark` | Output background. |
| `quality` | enum | `hq` | `sq`, `hq` | Standard or high-quality render. `hq` matches the main canvas export scale and is slower. |
| `engine` | enum | `auto` | `auto`, `browser`, `browserless`, `skia` | Renderer engine. `skia` uses the local MCP shared-core + CanvasKit renderer without server-side Chromium. |
| `returnLayout` | boolean | `false` | true/false | Include layout metadata when supported. |
| `shapeType` | string | `cloud` | 1-80 chars | Shape id. Use a built-in id or `custom` with `customShapeDefinition`. |
| `customShapeDefinition` | object | omitted | see below | Custom SVG path shape. Required when `shapeType` is `custom`. |
| `maxWords` | integer | `700` | 1-1000 | Maximum number of words to place. |
| `seed` | integer | `0` | 0-4294967295 | Unsigned 32-bit layout seed for reproducible browserless renders. Same input, options, and seed produce the same SVG/layout. |
| `fontFamily` | string | `Montserrat` | 1-80 chars | ShapeWords font family name, for example `Inter`, `Roboto`, `Montserrat`, `Noto Sans`. |
| `minFontSize` | integer | `18` | 4-400 | Minimum word font size. |
| `maxFontSize` | integer | `96` | 8-700 | Maximum word font size. |
| `padding` | integer | `3` | 0-100 | Pixel padding used by collision detection. |
| `rotationPreset` | enum | `orthogonal` | see below | Rotation preset matching the main ShapeWords canvas. |
| `rotations` | integer[] | omitted | -90 to 90, max 64 values | Explicit rotation angles. When provided, these override `rotationPreset`. |
| `spiralType` | enum | `archimedean` | `archimedean`, `rectangular` | Placement spiral algorithm. |
| `fillMode` | enum | `fill` | `fill`, `frequency` | Shape filling strategy. |
| `palette` | string[] | service default | up to 12 colors | Hex colors: `#rgb`, `#rrggbb`, or `#rrggbbaa`. |
| `colorMode` | enum | service default | `sequential`, `random`, `byFrequency` | How palette colors are assigned to words. |
| `returnImage` | boolean | `false` | `render_word_cloud` only | Download the finished SVG/PNG artifact and return it as MCP image content. |
| `pollIntervalMs` | integer | env/default | 250-10,000 | Polling interval for `render_word_cloud`. |
| `pollTimeoutMs` | integer | env/default | 1,000-180,000 | Maximum wait time for `render_word_cloud`. |

`get_word_cloud_job` accepts:

| Field | Type | Limits | Description |
| --- | --- | --- | --- |
| `jobId` | string | 6-64 chars | ShapeWords render job id. |

`words` items use this shape:

| Field | Type | Default | Limits | Description |
| --- | --- | --- | --- | --- |
| `text` | string | required | 1-120 chars | Display word or emoji. |
| `value` | integer | `1` | 1-100,000 | Weight/frequency used for sizing. |
| `kind` | enum | `word` | `word`, `emoji` | Word type. Emoji are kept horizontal by the renderer. |
| `sizeScale` | number | omitted | 0.1-5 | Optional extra size multiplier used by the ShapeWords layout core when available. |
| `repeat` | boolean | `true` | true/false | Whether the layout may repeat this word to improve shape filling. |

Rotation presets:

```text
horizontal, vertical, orthogonal, crossing, crossingVoids, dancing,
positiveSlope, negativeSlope, random, custom, mixed, angled, free
```

`renderProfile: "canvas"` sends the same practical defaults as the main editor canvas: `shapeType: "cloud"`, `width: 800`, `height: 600`, `quality: "hq"`, `maxWords: 700`, `seed: 0`, `fontFamily: "Montserrat"`, `minFontSize: 18`, `maxFontSize: 96`, `padding: 3`, `rotationPreset: "orthogonal"`, `spiralType: "archimedean"`, and `fillMode: "fill"`.

Use `renderProfile: "api"` only when you need the older compact Render API defaults: circle shape, 1024x640, SQ quality, and 120 max words.

## Text Input

The MCP server can send either raw `text`, explicit `words`, or both:

- repeated words increase frequency, for example `cloud cloud cloud render render API`;
- `words[]` preserves caller-provided weights and avoids differences in tokenization, stop words, or lemmatization;
- when both `text` and `words[]` are present, ShapeWords renders from `words[]` and keeps `text` as source context;
- paragraphs, meeting notes, workshop notes, prompts, research snippets, and keyword lists are valid;
- files such as CSV, Excel, or Google Sheets are not uploaded through this MCP server; paste or generate the text content first.

Example weighted text:

```json
{
  "text": "MCP MCP MCP ShapeWords ShapeWords word cloud word cloud render API agents tools",
  "shapeType": "cloud",
  "format": "svg",
  "seed": 12345
}
```

Example explicit weighted words:

```json
{
  "words": [
    { "text": "ShapeWords", "value": 12 },
    { "text": "MCP", "value": 9 },
    { "text": "canvas", "value": 7 },
    { "text": "layout", "value": 6 },
    { "text": "render", "value": 5 }
  ],
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

The local `engine: "skia"` path currently supports `rectangle`, `square`, `circle`, `diamond`, `triangle`, `star`, `heart`, `cloud`, custom SVG shapes, and vendored Font Awesome shape ids such as `fa-cat`. Unsupported local shape ids are rejected instead of silently changing the requested shape.

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

- text content with the completed job id and artifact location;
- `structuredContent.job` with normalized job metadata;
- `structuredContent.artifactUrl` for hosted renders;
- `structuredContent.localArtifact` for `engine: "skia"`;
- `structuredContent.siteUrl`;
- optional MCP image content when `returnImage` is `true` and `format` is `svg` or `png`.

For `engine: "skia"`, `render_word_cloud` always returns inline MCP image content for `format: "png"` or `format: "svg"` because there is no hosted artifact URL.

`create_word_cloud_job` returns the same metadata immediately after job creation, without waiting for completion.

`get_word_cloud_job` returns the latest job status and artifact URL.

Generated artifact URLs are short-lived because the ShapeWords Render API stores render jobs in memory.

## Format and Engine Notes

- `svg` is the recommended automation format: it is fast, compact, and works with the browserless shared-core renderer.
- `json` returns layout data from the same shared-core placement.
- `png` is rasterized from the same generated SVG/layout, so word placement matches SVG/JSON for the same input and options.
- `engine: "auto"` is recommended unless you need to force a specific path.
- `engine: "browserless"` supports `svg`, `json`, and `png`.
- `engine: "browser"` supports `svg` and `png`, not `json`.
- `engine: "skia"` is local-only and supported by `render_word_cloud`. It does not create pollable hosted jobs. Layout is generated by the vendored ShapeWords shared core; PNG is drawn directly with CanvasKit/Skia.
- `seed` is honored by browserless/shared-core renders. Use `engine: "auto"` or `engine: "browserless"` for reproducible API/MCP output.
- Non-zero `seed` with forced `engine: "browser"` is rejected by the Render API because the browser fallback does not use the deterministic shared-core seed path.

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
| `SHAPEWORDS_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout for hosted API and artifact requests. |
| `SHAPEWORDS_MAX_IMAGE_BYTES` | `8388608` | Max downloaded artifact size when `returnImage` is true. |

## Example Prompt

```text
Create a fast SVG word cloud about MCP, universal tools, word cloud generation, AI agents, and ShapeWords. Use the default ShapeWords canvas profile and return the artifact URL.
```

Example tool input:

```json
{
  "text": "MCP MCP MCP Model Context Protocol word cloud word cloud ShapeWords tools resources prompts stdio server client universal integration connector API render PNG SVG artifact agents automation context protocol schema",
  "locale": "en",
  "format": "svg",
  "width": 800,
  "height": 600,
  "background": "white",
  "quality": "hq",
  "engine": "auto",
  "returnLayout": false,
  "shapeType": "cloud",
  "seed": 12345,
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

### Local Skia PNG

```json
{
  "words": [
    { "text": "MCP", "value": 12 },
    { "text": "ShapeWords", "value": 10 },
    { "text": "Skia", "value": 8 },
    { "text": "CanvasKit", "value": 7 },
    { "text": "local", "value": 6 },
    { "text": "renderer", "value": 5 }
  ],
  "format": "png",
  "engine": "skia",
  "shapeType": "cloud",
  "width": 800,
  "height": 600,
  "quality": "sq",
  "seed": 12345
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
  "seed": 7,
  "maxWords": 80
}
```

### Reproducible SVG

```json
{
  "text": "MCP shared core browserless renderer reproducible seed deterministic layout",
  "format": "svg",
  "engine": "browserless",
  "shapeType": "cloud",
  "returnLayout": true,
  "seed": 12345
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
npm run smoke
npm run smoke:skia
npm run inspect
```

The server uses stdio and writes protocol messages to stdout. Diagnostics are written to stderr.

## Notes

- Set `returnImage: true` in `render_word_cloud` when the MCP client supports image content and needs hosted-render bytes inline. Local Skia image renders are inline automatically.
- For automation-heavy use, prefer SVG or JSON layout artifacts; request PNG only when the caller needs raster pixels.
- Set `seed` when the caller needs repeatable SVG/JSON/PNG placement across MCP runs. `engine: "skia"` is deterministic by default.
- Local Skia PNG output is capped at 40,000,000 pixels after quality scaling to avoid excessive local memory use.
- Local Skia font rendering currently supports bundled `Montserrat` and `OpenDyslexic` only. Hosted renders may support more font families.
- The MCP schema currently exposes rendering and style options only. It does not expose ShapeWords UI-only workflows such as the advanced word editor, 2D/3D view switching, CSV/Excel upload, Google Sheets import, or live room controls.
- `padding`, `rotationPreset`, `rotations`, `spiralType`, and `fillMode` are exposed so MCP callers can match the main ShapeWords canvas more closely.

See `THIRD_PARTY_NOTICES.txt` for bundled Font Awesome and font asset notices.
