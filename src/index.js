#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { setTimeout as delay } from 'node:timers/promises'

const VERSION = '0.2.1'
const DEFAULT_API_BASE_URL = 'https://shapewords.fun'
const API_BASE_URL = stripTrailingSlash(process.env.SHAPEWORDS_API_BASE_URL || DEFAULT_API_BASE_URL)
const RENDER_API_KEY = process.env.SHAPEWORDS_RENDER_API_KEY || process.env.SHAPEWORDS_API_KEY || ''
const POLL_INTERVAL_MS = readPositiveInteger(process.env.SHAPEWORDS_POLL_INTERVAL_MS, 1500)
const POLL_TIMEOUT_MS = readPositiveInteger(process.env.SHAPEWORDS_POLL_TIMEOUT_MS, 90_000)
const MAX_IMAGE_BYTES = readPositiveInteger(process.env.SHAPEWORDS_MAX_IMAGE_BYTES, 8 * 1024 * 1024)
const ROTATION_PRESET_VALUES = [
  'horizontal',
  'vertical',
  'orthogonal',
  'crossing',
  'crossingVoids',
  'dancing',
  'positiveSlope',
  'negativeSlope',
  'random',
  'custom',
  'mixed',
  'angled',
  'free',
]
const CANVAS_RENDER_DEFAULTS = Object.freeze({
  locale: 'en',
  format: 'svg',
  width: 800,
  height: 600,
  background: 'white',
  quality: 'hq',
  engine: 'auto',
  returnLayout: true,
  shapeType: 'cloud',
  maxWords: 700,
  seed: 0,
  fontFamily: 'Montserrat',
  minFontSize: 18,
  maxFontSize: 96,
  padding: 3,
  rotationPreset: 'orthogonal',
  spiralType: 'archimedean',
  fillMode: 'fill',
})
const API_RENDER_DEFAULTS = Object.freeze({
  locale: 'en',
  format: 'svg',
  width: 1024,
  height: 640,
  background: 'white',
  quality: 'sq',
  engine: 'auto',
  returnLayout: true,
  shapeType: 'circle',
  maxWords: 120,
  seed: 0,
})
const RENDER_OPTION_KEYS = [
  'locale',
  'format',
  'width',
  'height',
  'background',
  'quality',
  'engine',
  'returnLayout',
  'shapeType',
  'maxWords',
  'seed',
  'fontFamily',
  'minFontSize',
  'maxFontSize',
  'palette',
  'colorMode',
  'customShapeDefinition',
  'padding',
  'rotationPreset',
  'rotations',
  'spiralType',
  'fillMode',
]

const localeSchema = z.enum(['en', 'ru', 'ar', 'es', 'fr', 'zh'])
const formatSchema = z.enum(['png', 'svg', 'json'])
const backgroundSchema = z.enum(['transparent', 'white', 'dark'])
const qualitySchema = z.enum(['sq', 'hq'])
const colorModeSchema = z.enum(['sequential', 'random', 'byFrequency'])
const engineSchema = z.enum(['auto', 'browser', 'browserless'])
const renderProfileSchema = z.enum(['canvas', 'api'])
const fillModeSchema = z.enum(['fill', 'frequency'])
const spiralTypeSchema = z.enum(['archimedean', 'rectangular'])
const rotationPresetSchema = z.enum(ROTATION_PRESET_VALUES)
const wordItemSchema = z.object({
  text: z.string().min(1).max(120),
  value: z.number().int().min(1).max(100_000).default(1),
  kind: z.enum(['word', 'emoji']).optional(),
  sizeScale: z.number().min(0.1).max(5).optional(),
  repeat: z.boolean().default(true),
})
const customShapeDefinitionSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  nameEn: z.string().min(1).max(80).optional(),
  path: z.string().min(1).max(100_000),
  viewBox: z.string().min(1).max(120),
  fillRule: z.enum(['nonzero', 'evenodd']).optional(),
}).optional()

const renderOptionsShape = {
  renderProfile: renderProfileSchema.default('canvas').describe('Default option profile. canvas matches the main ShapeWords canvas; api keeps the older compact Render API defaults.'),
  text: z.string().min(1).max(100_000).optional().describe('Words, phrases, notes, or source text for the word cloud. Optional when words[] is provided.'),
  words: z.array(wordItemSchema).min(1).max(1000).optional().describe('Explicit weighted words. Use this when another system already tokenized, lemmatized, or scored the input.'),
  locale: localeSchema.optional().describe('ShapeWords UI/render locale. Canvas-profile default: en.'),
  format: formatSchema.optional().describe('Output artifact format. Canvas-profile default: svg.'),
  width: z.number().int().min(240).max(4096).optional().describe('Canvas width in pixels. Canvas-profile default: 800.'),
  height: z.number().int().min(240).max(4096).optional().describe('Canvas height in pixels. Canvas-profile default: 600.'),
  background: backgroundSchema.optional().describe('Output background style. Canvas-profile default: white.'),
  quality: qualitySchema.optional().describe('sq is faster, hq renders at higher device scale. Canvas-profile default: hq.'),
  engine: engineSchema.optional().describe('Renderer engine. auto uses the browserless shared-core renderer for supported formats.'),
  returnLayout: z.boolean().optional().describe('Ask the Render API to include layout JSON when supported. Canvas-profile default: true.'),
  shapeType: z.string().min(1).max(80).optional().describe('ShapeWords shape id, for example circle, rectangle, heart, star, cloud, diamond, custom. Canvas-profile default: cloud.'),
  customShapeDefinition: customShapeDefinitionSchema.describe('Custom SVG shape definition used when shapeType is custom.'),
  maxWords: z.number().int().min(1).max(1000).optional().describe('Maximum number of words to lay out. Canvas-profile default: 700.'),
  seed: z.number().int().min(0).max(0xffffffff).optional().describe('Unsigned 32-bit layout seed for reproducible browserless ShapeWords renders. Canvas-profile default: 0. Use engine auto or browserless; browser fallback does not support non-zero seed.'),
  fontFamily: z.string().min(1).max(80).optional().describe('ShapeWords font family name. Canvas-profile default: Montserrat.'),
  minFontSize: z.number().int().min(4).max(400).optional(),
  maxFontSize: z.number().int().min(8).max(700).optional(),
  palette: z.array(z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu)).max(12).optional(),
  colorMode: colorModeSchema.optional(),
  padding: z.number().int().min(0).max(100).optional().describe('Word collision padding in pixels. Canvas-profile default: 3.'),
  rotationPreset: rotationPresetSchema.optional().describe('Rotation preset matching the ShapeWords canvas. Canvas-profile default: orthogonal.'),
  rotations: z.array(z.number().int().min(-90).max(90)).min(1).max(64).optional().describe('Explicit rotation angles in degrees. When provided, these override rotationPreset.'),
  spiralType: spiralTypeSchema.optional().describe('Placement spiral algorithm. Canvas-profile default: archimedean.'),
  fillMode: fillModeSchema.optional().describe('Shape filling strategy. Canvas-profile default: fill.'),
}

const server = new McpServer({
  name: 'shapewords-mcp',
  version: VERSION,
})

server.registerTool(
  'render_word_cloud',
  {
    title: 'Render word cloud',
    description: 'Create a ShapeWords word cloud, wait for completion, and return the artifact URL plus optional image content.',
    inputSchema: {
      ...renderOptionsShape,
      returnImage: z.boolean().default(false).describe('Download the artifact and return it as MCP image content when supported by the client.'),
      pollIntervalMs: z.number().int().min(250).max(10_000).optional(),
      pollTimeoutMs: z.number().int().min(1000).max(180_000).optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (input) => {
    const payload = toRenderPayload(input)
    const job = await createRenderJob(payload)
    const completedJob = await waitForRenderJob(job, {
      pollIntervalMs: input.pollIntervalMs || POLL_INTERVAL_MS,
      pollTimeoutMs: input.pollTimeoutMs || POLL_TIMEOUT_MS,
    })
    const artifactUrl = getArtifactUrl(completedJob)
    const artifactFormat = payload.options.format
    const structuredContent = {
      job: completedJob,
      artifactUrl,
      siteUrl: API_BASE_URL,
    }

    const content = [
      {
        type: 'text',
        text: [
          `ShapeWords render completed: ${completedJob.id}`,
          `Artifact URL: ${artifactUrl}`,
          `Format: ${artifactFormat}`,
        ].join('\n'),
      },
    ]

    if (input.returnImage) {
      if (!['png', 'svg'].includes(artifactFormat)) {
        throw new Error('returnImage is supported only for png and svg formats.')
      }
      const image = await fetchArtifactAsImageContent(artifactUrl)
      content.push(image)
    }

    return { content, structuredContent }
  },
)

server.registerTool(
  'create_word_cloud_job',
  {
    title: 'Create word cloud job',
    description: 'Start a ShapeWords render job and return status/artifact URLs without waiting for completion.',
    inputSchema: renderOptionsShape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (input) => {
    const payload = toRenderPayload(input)
    const job = await createRenderJob(payload)
    const artifactUrl = getArtifactUrl(job)
    return {
      content: [
        {
          type: 'text',
          text: `ShapeWords job created: ${job.id}\nStatus URL: ${absoluteUrl(job.statusUrl)}\nArtifact URL: ${artifactUrl}`,
        },
      ],
      structuredContent: {
        job,
        artifactUrl,
        siteUrl: API_BASE_URL,
      },
    }
  },
)

server.registerTool(
  'get_word_cloud_job',
  {
    title: 'Get word cloud job',
    description: 'Check a ShapeWords render job status by ID.',
    inputSchema: {
      jobId: z.string().min(6).max(64).describe('ShapeWords render job id.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ jobId }) => {
    const job = await getRenderJob(jobId)
    const artifactUrl = getArtifactUrl(job)
    return {
      content: [
        {
          type: 'text',
          text: `ShapeWords job ${job.id}: ${job.status}\nArtifact URL: ${artifactUrl}`,
        },
      ],
      structuredContent: {
        job,
        artifactUrl,
        siteUrl: API_BASE_URL,
      },
    }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error(`ShapeWords MCP failed: ${error?.message || String(error)}`)
  process.exit(1)
})

function toRenderPayload(input) {
  const renderProfile = input.renderProfile === 'api' ? 'api' : 'canvas'
  const options = {
    ...(renderProfile === 'api' ? API_RENDER_DEFAULTS : CANVAS_RENDER_DEFAULTS),
  }

  for (const key of RENDER_OPTION_KEYS) {
    if (input[key] !== undefined) {
      options[key] = input[key]
    }
  }

  if (Array.isArray(input.rotations) && input.rotations.length > 0 && input.rotationPreset === undefined) {
    delete options.rotationPreset
  }

  const text = typeof input.text === 'string' && input.text.trim() ? input.text : ''
  const words = Array.isArray(input.words) ? input.words : []

  if (!text && words.length === 0) {
    throw new Error('Provide either text or words[] for ShapeWords rendering.')
  }

  return {
    input: {
      ...(text ? { text } : {}),
      ...(words.length ? { words } : {}),
    },
    options,
  }
}

async function createRenderJob(payload) {
  const response = await fetchJson('/api/render/wordcloud', {
    method: 'POST',
    headers: renderHeaders(),
    body: JSON.stringify(payload),
  })
  return normalizeJob(response)
}

async function getRenderJob(jobId) {
  const response = await fetchJson(`/api/render/wordcloud/${encodeURIComponent(jobId)}`, {
    headers: renderHeaders(false),
  })
  return normalizeJob(response)
}

async function waitForRenderJob(initialJob, options) {
  let job = initialJob
  const deadline = Date.now() + options.pollTimeoutMs

  while (!isFinishedStatus(job.status)) {
    if (isFailedStatus(job.status)) {
      throw new Error(`ShapeWords render failed: ${formatJobError(job.error)}`)
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ShapeWords job ${job.id}. Last status: ${job.status || 'unknown'}.`)
    }

    await delay(options.pollIntervalMs)
    job = await getRenderJob(job.id)
  }

  return job
}

async function fetchArtifactAsImageContent(url) {
  const response = await fetch(url, {
    headers: RENDER_API_KEY ? { Authorization: `Bearer ${RENDER_API_KEY}` } : undefined,
  })
  if (!response.ok) {
    throw new Error(`Artifact download failed with HTTP ${response.status}.`)
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Artifact is ${bytes.length} bytes, above SHAPEWORDS_MAX_IMAGE_BYTES=${MAX_IMAGE_BYTES}.`)
  }

  return {
    type: 'image',
    data: bytes.toString('base64'),
    mimeType,
  }
}

async function fetchJson(path, options) {
  const url = absoluteUrl(path)
  const response = await fetch(url, options)
  const text = await response.text()
  const data = text ? parseJson(text, url) : {}

  if (!response.ok) {
    const message = data?.error?.message || data?.message || text || `HTTP ${response.status}`
    throw new Error(`ShapeWords API request failed: ${message}`)
  }

  return data
}

function normalizeJob(payload) {
  const job = payload.job || payload.result || payload
  const id = job.id || payload.id
  if (!id) throw new Error('ShapeWords API response did not include a job id.')

  return {
    id,
    status: String(job.status || payload.status || '').toLowerCase(),
    createdAt: job.createdAt || payload.createdAt,
    updatedAt: job.updatedAt || payload.updatedAt,
    statusUrl: absoluteUrl(job.statusUrl || payload.statusUrl || `/api/render/wordcloud/${id}`),
    resultUrl: job.resultUrl ? absoluteUrl(job.resultUrl) : null,
    error: job.error || payload.error || null,
    result: job.result || payload.result || null,
    metrics: job.metrics || payload.metrics || null,
  }
}

function getArtifactUrl(job) {
  return job.resultUrl || absoluteUrl(`/api/render/wordcloud/${encodeURIComponent(job.id)}/artifact`)
}

function renderHeaders(includeBodyHeaders = true) {
  const headers = {
    Accept: 'application/json',
  }
  if (includeBodyHeaders) headers['Content-Type'] = 'application/json'
  if (RENDER_API_KEY) headers.Authorization = `Bearer ${RENDER_API_KEY}`
  return headers
}

function absoluteUrl(pathOrUrl) {
  return new URL(pathOrUrl, `${API_BASE_URL}/`).toString()
}

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function parseJson(text, url) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 160)}`)
  }
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isFinishedStatus(status) {
  return ['complete', 'completed', 'done', 'finished', 'ready', 'success', 'succeeded'].includes(status)
}

function isFailedStatus(status) {
  return ['canceled', 'cancelled', 'error', 'failed', 'failure'].includes(status)
}

function formatJobError(error) {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string') return error.message
  return JSON.stringify(error)
}
