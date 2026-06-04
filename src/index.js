#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { setTimeout as delay } from 'node:timers/promises'

const VERSION = '0.1.0'
const DEFAULT_API_BASE_URL = 'https://shapewords.fun'
const API_BASE_URL = stripTrailingSlash(process.env.SHAPEWORDS_API_BASE_URL || DEFAULT_API_BASE_URL)
const RENDER_API_KEY = process.env.SHAPEWORDS_RENDER_API_KEY || process.env.SHAPEWORDS_API_KEY || ''
const POLL_INTERVAL_MS = readPositiveInteger(process.env.SHAPEWORDS_POLL_INTERVAL_MS, 1500)
const POLL_TIMEOUT_MS = readPositiveInteger(process.env.SHAPEWORDS_POLL_TIMEOUT_MS, 90_000)
const MAX_IMAGE_BYTES = readPositiveInteger(process.env.SHAPEWORDS_MAX_IMAGE_BYTES, 8 * 1024 * 1024)

const localeSchema = z.enum(['en', 'ru', 'ar', 'es', 'fr', 'zh'])
const formatSchema = z.enum(['png', 'svg', 'json'])
const backgroundSchema = z.enum(['transparent', 'white', 'dark'])
const qualitySchema = z.enum(['sq', 'hq'])
const colorModeSchema = z.enum(['sequential', 'random', 'byFrequency'])
const engineSchema = z.enum(['auto', 'browser', 'browserless'])
const customShapeDefinitionSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  nameEn: z.string().min(1).max(80).optional(),
  path: z.string().min(1).max(100_000),
  viewBox: z.string().min(1).max(120),
  fillRule: z.enum(['nonzero', 'evenodd']).optional(),
}).optional()

const renderOptionsShape = {
  text: z.string().min(1).max(100_000).describe('Words, phrases, notes, or source text for the word cloud.'),
  locale: localeSchema.default('en').describe('ShapeWords UI/render locale.'),
  format: formatSchema.default('svg').describe('Output artifact format. SVG is the fastest MCP default; PNG uses the browser fallback.'),
  width: z.number().int().min(240).max(4096).default(1024).describe('Canvas width in pixels.'),
  height: z.number().int().min(240).max(4096).default(640).describe('Canvas height in pixels.'),
  background: backgroundSchema.default('white').describe('Output background style.'),
  quality: qualitySchema.default('sq').describe('sq is faster, hq renders at higher device scale.'),
  engine: engineSchema.default('auto').describe('Renderer engine. auto uses browserless for SVG/JSON and browser fallback for PNG.'),
  returnLayout: z.boolean().default(true).describe('Ask the Render API to include layout JSON when supported.'),
  shapeType: z.string().min(1).max(80).default('circle').describe('ShapeWords shape id, for example circle, rectangle, heart, star, cloud, diamond, custom.'),
  customShapeDefinition: customShapeDefinitionSchema.describe('Custom SVG shape definition used when shapeType is custom.'),
  maxWords: z.number().int().min(1).max(1000).default(120).describe('Maximum number of words to lay out.'),
  fontFamily: z.string().min(1).max(80).optional().describe('Optional ShapeWords font family name.'),
  minFontSize: z.number().int().min(4).max(400).optional(),
  maxFontSize: z.number().int().min(8).max(700).optional(),
  palette: z.array(z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu)).max(12).optional(),
  colorMode: colorModeSchema.optional(),
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
    const job = await createRenderJob(toRenderPayload(input))
    const completedJob = await waitForRenderJob(job, {
      pollIntervalMs: input.pollIntervalMs || POLL_INTERVAL_MS,
      pollTimeoutMs: input.pollTimeoutMs || POLL_TIMEOUT_MS,
    })
    const artifactUrl = getArtifactUrl(completedJob)
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
          `Format: ${input.format || 'png'}`,
        ].join('\n'),
      },
    ]

    if (input.returnImage) {
      if (!['png', 'svg'].includes(input.format || 'svg')) {
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
    const job = await createRenderJob(toRenderPayload(input))
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
  const options = {
    locale: input.locale || 'en',
    format: input.format || 'svg',
    width: input.width || 1024,
    height: input.height || 640,
    background: input.background || 'white',
    quality: input.quality || 'sq',
    shapeType: input.shapeType || 'circle',
    maxWords: input.maxWords || 120,
    engine: input.engine || 'auto',
    returnLayout: input.returnLayout !== false,
  }

  for (const key of ['fontFamily', 'minFontSize', 'maxFontSize', 'palette', 'colorMode', 'customShapeDefinition']) {
    if (input[key] !== undefined) options[key] = input[key]
  }

  return {
    input: { text: input.text },
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
