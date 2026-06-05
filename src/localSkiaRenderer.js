import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import CanvasKitInit from 'canvaskit-wasm'
import { createCanvas, ImageData, Path2D } from '@napi-rs/canvas'
import { fontAwesomeShapes } from './fontAwesomeShapes.mjs'

const DEFAULT_PALETTE = ['#7c3aed', '#14b8a6', '#111827', '#f59e0b', '#2563eb']
const DARK_BACKGROUND = '#07111f'
const WORD_SPLIT_RE = /[\s,.:;!?(){}[\]"'«»\-–—/\\@#$%^&*+=|<>~`]+/u
const LETTER_RE = /\p{L}/u
const XML_ESCAPE_RE = /[&<>"']/g
const SOURCE_LABEL = 'source: shapewords'
const SHAPE_PADDING = 0.025
const INTERNAL_SHAPE_GUARD_PX = 2
const SHAPE_MASK_ALPHA_THRESHOLD = 128
const DEFAULT_FONT_FAMILY = 'Montserrat'
const DEFAULT_FONT_STYLE_ID = 'regular'
const DEFAULT_FONT_WEIGHT = '400'
const DEFAULT_FONT_STYLE = 'normal'
const DEFAULT_MIN_FONT_SIZE = 18
const DEFAULT_MAX_FONT_SIZE = 96
const DEFAULT_PADDING = 3
const DEFAULT_SPIRAL_TYPE = 'archimedean'
const DEFAULT_FILL_MODE = 'fill'
const DEFAULT_ROTATIONS = [0, 90]
const MAX_SKIA_OUTPUT_PIXELS = 40_000_000

const ROTATION_PRESETS = {
  horizontal: [0],
  vertical: [90],
  orthogonal: [0, 90],
  crossing: [0, 90, -45, 45],
  crossingVoids: [-45, 45],
  dancing: [-35, -22, -12, 0, 12, 22, 35],
  positiveSlope: [-30],
  negativeSlope: [30],
  random: Array.from({ length: 37 }, (_, index) => -90 + index * 5),
  custom: [0, -30, 30, 90],
  mixed: [0, 0, 0, 90],
  angled: [-60, -30, 0, 30, 60],
  free: Array.from({ length: 37 }, (_, index) => -90 + index * 5),
}

const BASIC_SHAPES = {
  rectangle: {
    id: 'rectangle',
    viewBox: '0 0 100 100',
    path: 'M 0 0 H 100 V 100 H 0 Z',
    fillRule: 'nonzero',
  },
  square: {
    id: 'square',
    viewBox: '0 0 100 100',
    path: 'M 0 0 H 100 V 100 H 0 Z',
    fillRule: 'nonzero',
  },
  circle: {
    id: 'circle',
    viewBox: '0 0 100 100',
    path: 'M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z',
    fillRule: 'nonzero',
  },
  diamond: {
    id: 'diamond',
    viewBox: '0 0 100 100',
    path: 'M 50 0 L 100 50 L 50 100 L 0 50 Z',
    fillRule: 'nonzero',
  },
  triangle: {
    id: 'triangle',
    viewBox: '0 0 100 87',
    path: 'M 50 0 L 100 87 L 0 87 Z',
    fillRule: 'nonzero',
  },
  star: {
    id: 'star',
    viewBox: '0 0 100 100',
    path: 'M 50 0 L 61 35 L 98 35 L 68 57 L 79 91 L 50 70 L 21 91 L 32 57 L 2 35 L 39 35 Z',
    fillRule: 'nonzero',
  },
  heart: {
    id: 'heart',
    viewBox: '0 0 100 100',
    path: 'M 50 90 C 25 70, 0 50, 0 30 A 25 25 0 0 1 50 30 A 25 25 0 0 1 100 30 C 100 50, 75 70, 50 90 Z',
    fillRule: 'nonzero',
  },
  cloud: {
    id: 'cloud',
    viewBox: '0 0 120 80',
    path: 'M 30 70 A 20 20 0 0 1 10 50 A 20 20 0 0 1 25 32 A 25 25 0 0 1 50 10 A 30 30 0 0 1 85 20 A 20 20 0 0 1 110 45 A 20 20 0 0 1 95 70 Z',
    fillRule: 'nonzero',
  },
}

const FONT_AWESOME_SHAPES = new Map(fontAwesomeShapes.map((shape) => [shape.id, {
  id: shape.id,
  viewBox: shape.viewBox,
  path: shape.path,
  fillRule: shape.fillRule || 'nonzero',
}]))

const MONTSERRAT_FONT_ASSETS = [
  {
    path: 'montserrat/JTUSjIg1_i6t8kCHKm459WRhyyTh89ZNpQ.woff2',
    weight: '400 700',
    style: 'normal',
    subset: 'cyrillic-ext',
    unicodeRange: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
  },
  {
    path: 'montserrat/JTUSjIg1_i6t8kCHKm459W1hyyTh89ZNpQ.woff2',
    weight: '400 700',
    style: 'normal',
    subset: 'cyrillic',
    unicodeRange: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  },
  {
    path: 'montserrat/JTUSjIg1_i6t8kCHKm459WZhyyTh89ZNpQ.woff2',
    weight: '400 700',
    style: 'normal',
    subset: 'vietnamese',
    unicodeRange: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
  },
  {
    path: 'montserrat/JTUSjIg1_i6t8kCHKm459WdhyyTh89ZNpQ.woff2',
    weight: '400 700',
    style: 'normal',
    subset: 'latin-ext',
    unicodeRange: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
  {
    path: 'montserrat/JTUSjIg1_i6t8kCHKm459WlhyyTh89Y.woff2',
    weight: '400 700',
    style: 'normal',
    subset: 'latin',
    unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
]

const OPENDYSLEXIC_FONT_ASSETS = [
  {
    path: 'opendyslexic/latin-400-normal.woff2',
    weight: '400',
    style: 'normal',
    subset: 'latin',
  },
  {
    path: 'opendyslexic/latin-700-normal.woff2',
    weight: '700',
    style: 'normal',
    subset: 'latin',
  },
]

let sharedCorePromise = null
let canvasKitPromise = null

export async function renderLocalSkiaWordCloud(payload) {
  const startedAt = Date.now()
  const createdAt = new Date().toISOString()
  const id = `local-skia-${randomUUID()}`
  const options = normalizeLocalOptions(payload.options || {})
  const shape = resolveShape(options)
  validateSkiaSurfaceSize(options)
  const mask = createShapeMask(shape, options.width, options.height)
  if (!mask) throw new Error('Unable to create a local shape mask.')

  const sourceWords = resolveInputWords(payload.input || {}, options.maxWords)
  const fontAssets = resolveLocalFontAssets(options.fontFamily)
  const { runShapeLayoutCore } = await loadSharedCore()
  let completeMessage = null

  await runShapeLayoutCore({
    requestId: 1,
    layoutMode: shape.id === 'rectangle' ? 'rectangle' : 'shape',
    maskData: mask.data,
    maskWidth: mask.width,
    maskHeight: mask.height,
    words: sourceWords.map((word) => ({
      text: word.text,
      value: word.value,
      kind: word.kind,
      sizeScale: word.sizeScale,
      repeat: word.repeat !== false,
      fontWeight: DEFAULT_FONT_WEIGHT,
      fontStyle: DEFAULT_FONT_STYLE,
      fontAssets,
    })),
    fontFamily: options.fontFamily,
    fontStyleId: DEFAULT_FONT_STYLE_ID,
    fontWeight: DEFAULT_FONT_WEIGHT,
    fontStyle: DEFAULT_FONT_STYLE,
    fontAssets,
    rotations: options.rotations,
    padding: options.padding,
    minFontSize: options.minFontSize,
    maxFontSize: options.maxFontSize,
    maxWords: options.maxWords,
    spiralType: options.spiralType,
    fillMode: options.fillMode,
    layoutTimeScale: resolveLayoutTimeScale(options),
    seed: options.seed,
    deterministic: true,
    profileEnabled: false,
    canvasWidth: options.width,
    canvasHeight: options.height,
  }, {
    postMessage: (message) => {
      if (message.type === 'complete') completeMessage = message
    },
  })

  if (!completeMessage) throw new Error('Local ShapeWords layout core did not complete.')

  const layout = buildLayout(completeMessage.words, sourceWords, options, shape)
  const svg = buildSvg(layout, options, shape)
  const metrics = {
    words: sourceWords.length,
    placedWords: layout.words.length,
    width: options.width,
    height: options.height,
    engine: 'local-skia-shared-core',
    layoutMs: Date.now() - startedAt,
    layoutTimeScale: resolveLayoutTimeScale(options),
    seed: options.seed,
    deterministic: true,
  }

  const artifact = await buildArtifact(svg, layout, options, shape)
  const updatedAt = new Date().toISOString()
  const result = {
    mimeType: artifact.mimeType,
    filename: artifact.filename,
    width: artifact.width,
    height: artifact.height,
    bytes: artifact.bytes,
    ...(options.returnLayout ? { layout } : {}),
  }

  return {
    job: {
      id,
      status: 'completed',
      createdAt,
      updatedAt,
      statusUrl: null,
      resultUrl: null,
      engine: 'skia',
      error: null,
      result,
      metrics,
    },
    artifact,
    metrics,
    layout: options.returnLayout ? layout : null,
  }
}

async function buildArtifact(svg, layout, options, shape) {
  if (options.format === 'json') {
    const text = JSON.stringify({
      engine: 'local-skia-shared-core',
      metrics: {
        width: options.width,
        height: options.height,
        words: layout.words.length,
        seed: options.seed,
      },
      layout,
      artifact: {
        mimeType: 'image/svg+xml',
        text: svg,
        width: options.width,
        height: options.height,
      },
    })
    return {
      text,
      mimeType: 'application/json',
      filename: makeFilename('json'),
      width: options.width,
      height: options.height,
      bytes: Buffer.byteLength(text),
    }
  }

  if (options.format === 'png') {
    return renderSkiaPng(layout, options, shape)
  }

  return {
    text: svg,
    mimeType: 'image/svg+xml',
    filename: makeFilename('svg'),
    width: options.width,
    height: options.height,
    bytes: Buffer.byteLength(svg),
  }
}

async function renderSkiaPng(layout, options, shape) {
  const CanvasKit = await loadCanvasKit()
  const scale = options.quality === 'hq' ? 4 : 2
  const width = Math.max(1, Math.round(options.width * scale))
  const height = Math.max(1, Math.round(options.height * scale))
  const surface = CanvasKit.MakeSurface(width, height)
  if (!surface) throw new Error('CanvasKit failed to create a raster surface.')

  const canvas = surface.getCanvas()
  canvas.clear(parseSkiaColor(CanvasKit, getBackgroundFill(options.background) || '#00000000'))
  canvas.scale(scale, scale)

  const shapePath = CanvasKit.Path.MakeFromSVGString(shape.path)
  if (!shapePath) throw new Error(`CanvasKit could not parse shape path for "${shape.id}".`)

  const shapeTransform = computeShapeTransform(shape.viewBox, options.width, options.height)
  const background = getBackgroundFill(options.background)
  if (background && background !== '#00000000') {
    const fillPaint = makePaint(CanvasKit, background)
    canvas.drawRect(CanvasKit.XYWHRect(0, 0, options.width, options.height), fillPaint)
    fillPaint.delete()
  }

  if (shapeTransform) {
    const outlinePaint = new CanvasKit.Paint()
    outlinePaint.setAntiAlias(true)
    outlinePaint.setColor(parseSkiaColor(CanvasKit, '#cbd5e1'))
    outlinePaint.setStyle(CanvasKit.PaintStyle.Stroke)
    outlinePaint.setStrokeWidth(1.1 / shapeTransform.scale)
    canvas.save()
    canvas.translate(shapeTransform.offsetX, shapeTransform.offsetY)
    canvas.scale(shapeTransform.scale, shapeTransform.scale)
    canvas.drawPath(shapePath, outlinePaint)
    canvas.restore()
    outlinePaint.delete()
  }

  canvas.save()
  if (shapeTransform) {
    canvas.translate(shapeTransform.offsetX, shapeTransform.offsetY)
    canvas.scale(shapeTransform.scale, shapeTransform.scale)
    canvas.clipPath(shapePath, CanvasKit.ClipOp.Intersect, true)
    canvas.scale(1 / shapeTransform.scale, 1 / shapeTransform.scale)
    canvas.translate(-shapeTransform.offsetX, -shapeTransform.offsetY)
  }
  canvas.translate(options.width / 2, options.height / 2)

  for (const word of layout.words) {
    drawSkiaWord(CanvasKit, canvas, word)
  }
  canvas.restore()

  drawWatermark(CanvasKit, canvas, options)

  const image = surface.makeImageSnapshot()
  const bytes = Buffer.from(image.encodeToBytes(CanvasKit.ImageFormat.PNG, 100))
  image.delete()
  shapePath.delete()
  surface.delete()

  return {
    data: bytes,
    mimeType: 'image/png',
    filename: makeFilename('png'),
    width,
    height,
    bytes: bytes.length,
  }
}

function drawSkiaWord(CanvasKit, canvas, word) {
  const paint = makePaint(CanvasKit, word.fill || '#111827')
  canvas.save()
  canvas.translate(Number(word.x) || 0, Number(word.y) || 0)
  canvas.rotate(word.kind === 'emoji' ? 0 : Number(word.rotate) || 0, 0, 0)

  if (word.outlinePath) {
    const path = CanvasKit.Path.MakeFromSVGString(word.outlinePath)
    if (path) {
      const baseSize = Number(word.outlineBaseSize)
      const size = Number(word.size)
      const pathScale = Number.isFinite(baseSize) && baseSize > 0 && Number.isFinite(size)
        ? size / baseSize
        : 1
      if (Math.abs(pathScale - 1) > 0.0001) canvas.scale(pathScale, pathScale)
      canvas.drawPath(path, paint)
      path.delete()
    }
  } else {
    const font = new CanvasKit.Font(null, Math.max(1, Number(word.size) || 18))
    font.setEdging(CanvasKit.FontEdging.AntiAlias)
    canvas.drawText(String(word.text || ''), 0, 0, paint, font)
    font.delete()
  }

  canvas.restore()
  paint.delete()
}

function drawWatermark(CanvasKit, canvas, options) {
  const fill = options.background === 'dark' ? '#94a3b8' : '#7c8798'
  const paint = makePaint(CanvasKit, fill)
  const font = new CanvasKit.Font(null, Math.max(12, Math.round(options.height * 0.035)))
  font.setEdging(CanvasKit.FontEdging.AntiAlias)
  const text = SOURCE_LABEL
  const x = Math.max(8, options.width - 20 - text.length * Math.max(6, font.getSize?.() || 12) * 0.48)
  const y = options.height - 18
  canvas.drawText(text, x, y, paint, font)
  font.delete()
  paint.delete()
}

function makePaint(CanvasKit, color) {
  const paint = new CanvasKit.Paint()
  paint.setAntiAlias(true)
  paint.setColor(parseSkiaColor(CanvasKit, color))
  paint.setStyle(CanvasKit.PaintStyle.Fill)
  return paint
}

function parseSkiaColor(CanvasKit, value) {
  const { r, g, b, a } = parseHexColor(value)
  return CanvasKit.Color(r, g, b, a)
}

function parseHexColor(value) {
  const raw = String(value || '').trim()
  if (raw === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu)
  if (!match) return { r: 17, g: 24, b: 39, a: 255 }
  const hex = match[1]
  if (hex.length === 3) {
    return {
      r: Number.parseInt(hex[0] + hex[0], 16),
      g: Number.parseInt(hex[1] + hex[1], 16),
      b: Number.parseInt(hex[2] + hex[2], 16),
      a: 255,
    }
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255,
  }
}

function normalizeLocalOptions(options) {
  return {
    ...options,
    format: ['png', 'svg', 'json'].includes(options.format) ? options.format : 'svg',
    width: clampInteger(options.width, 800, 240, 4096),
    height: clampInteger(options.height, 600, 240, 4096),
    maxWords: clampInteger(options.maxWords, 300, 1, 1000),
    fontFamily: String(options.fontFamily || DEFAULT_FONT_FAMILY).trim() || DEFAULT_FONT_FAMILY,
    minFontSize: clampInteger(options.minFontSize, DEFAULT_MIN_FONT_SIZE, 4, 400),
    maxFontSize: clampInteger(options.maxFontSize, DEFAULT_MAX_FONT_SIZE, 8, 700),
    padding: clampInteger(options.padding, DEFAULT_PADDING, 0, 100),
    seed: normalizeSeed(options.seed),
    rotations: normalizeRotations(options),
    spiralType: options.spiralType === 'rectangular' ? 'rectangular' : DEFAULT_SPIRAL_TYPE,
    fillMode: options.fillMode === 'frequency' ? 'frequency' : DEFAULT_FILL_MODE,
    background: ['transparent', 'white', 'dark'].includes(options.background) ? options.background : 'white',
    returnLayout: options.returnLayout === true,
  }
}

function resolveLayoutTimeScale(options) {
  if (options.fillMode === 'frequency') return 1
  const area = Math.max(1, Number(options.width) * Number(options.height))
  const areaScale = area >= 1_400_000 ? 2.25 : area >= 720_000 ? 1.8 : 1.35
  const qualityScale = options.quality === 'hq' ? 1.15 : 1
  return Math.round(Math.min(3, areaScale * qualityScale) * 100) / 100
}

function clampInteger(value, fallback, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

function normalizeSeed(value) {
  const seed = Number(value ?? 0)
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

function normalizeRotations(options) {
  if (Array.isArray(options.rotations)) {
    const values = options.rotations
      .map((value) => Number(value))
      .filter(Number.isFinite)
      .map((value) => Math.max(-90, Math.min(90, Math.round(value))))
    const unique = Array.from(new Set(values))
    if (unique.length > 0) return unique
  }

  const preset = String(options.rotationPreset || '').trim()
  return ROTATION_PRESETS[preset] || DEFAULT_ROTATIONS
}

async function loadSharedCore() {
  installNodeCanvasRuntime()
  sharedCorePromise ??= import('./generated/render-core/shapeLayoutCore.js')
  return sharedCorePromise
}

async function loadCanvasKit() {
  canvasKitPromise ??= CanvasKitInit()
  return canvasKitPromise
}

function installNodeCanvasRuntime() {
  globalThis.OffscreenCanvas ??= NodeOffscreenCanvas
  globalThis.Path2D ??= Path2D
  globalThis.ImageData ??= ImageData
  globalThis.self ??= { location: { hostname: '' } }
  installFileFetch()
}

function installFileFetch() {
  if (globalThis.__shapewordsMcpFileFetchInstalled) return
  const nativeFetch = globalThis.fetch?.bind(globalThis)
  if (!nativeFetch) return

  globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' || input instanceof URL
      ? String(input)
      : typeof input?.url === 'string'
        ? input.url
        : ''

    if (rawUrl.startsWith('file:')) {
      const bytes = await readFile(fileURLToPath(rawUrl))
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': contentTypeForPath(rawUrl),
        },
      })
    }

    return nativeFetch(input, init)
  }
  globalThis.__shapewordsMcpFileFetchInstalled = true
}

function contentTypeForPath(value) {
  if (/\.woff2(?:$|\?)/i.test(value)) return 'font/woff2'
  if (/\.woff(?:$|\?)/i.test(value)) return 'font/woff'
  if (/\.ttf(?:$|\?)/i.test(value)) return 'font/ttf'
  if (/\.otf(?:$|\?)/i.test(value)) return 'font/otf'
  return 'application/octet-stream'
}

class NodeOffscreenCanvas {
  constructor(width, height) {
    this.canvas = createCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
  }

  get width() {
    return this.canvas.width
  }

  set width(value) {
    this.canvas.width = Math.max(1, Math.round(value))
  }

  get height() {
    return this.canvas.height
  }

  set height(value) {
    this.canvas.height = Math.max(1, Math.round(value))
  }

  getContext(type, options) {
    return this.canvas.getContext(type, options)
  }
}

function resolveLocalFontAssets(fontFamily) {
  const normalized = fontFamily.trim().toLowerCase()
  if (normalized === 'montserrat') return toLocalFontAssets(MONTSERRAT_FONT_ASSETS)
  if (normalized === 'opendyslexic' || normalized === 'open dyslexic') {
    return toLocalFontAssets(OPENDYSLEXIC_FONT_ASSETS)
  }
  throw new Error(`Local Skia renderer supports only Montserrat and OpenDyslexic fonts. Received: ${fontFamily}`)
}

function toLocalFontAssets(assets) {
  return assets.map((asset) => ({
    url: new URL(`./generated/render-core/local-fonts/${asset.path}`, import.meta.url).href,
    format: 'woff2',
    weight: asset.weight,
    style: asset.style,
    subset: asset.subset,
    unicodeRange: asset.unicodeRange,
  }))
}

function resolveInputWords(input, maxWords) {
  if (Array.isArray(input.words)) {
    const seen = new Set()
    return input.words
      .map((item) => {
        const text = String(item?.text || '').trim().replace(/\s+/g, ' ').slice(0, 120)
        if (!text) return null
        const kind = item?.kind === 'emoji' ? 'emoji' : 'word'
        const key = `${kind}:${text.toLocaleLowerCase()}`
        if (seen.has(key)) return null
        seen.add(key)
        const value = Number(item?.value)
        const sizeScale = Number(item?.sizeScale)
        return {
          text,
          value: Number.isFinite(value) ? Math.max(1, Math.min(100_000, Math.round(value))) : 1,
          kind,
          ...(Number.isFinite(sizeScale) ? { sizeScale: Math.max(0.1, Math.min(5, sizeScale)) } : {}),
          repeat: item?.repeat !== false,
        }
      })
      .filter(Boolean)
      .slice(0, maxWords)
  }

  return processWords(input.text || '', maxWords)
}

function processWords(text, maxWords) {
  const counts = new Map()
  const display = new Map()
  const normalized = String(text || '').normalize('NFKC')
  const tokens = normalized.split(WORD_SPLIT_RE).filter((token) => token.length > 1 && LETTER_RE.test(token))

  for (const token of tokens) {
    const key = token.toLowerCase()
    counts.set(key, (counts.get(key) || 0) + 1)
    if (!display.has(key)) display.set(key, token)
  }

  return Array.from(counts.entries())
    .map(([key, value]) => ({ text: display.get(key) || key, value, kind: 'word' }))
    .sort((a, b) => b.value - a.value || a.text.localeCompare(b.text))
    .slice(0, maxWords)
}

function resolveShape(options) {
  if (options.customShapeDefinition?.path && options.customShapeDefinition?.viewBox) {
    return {
      id: 'custom',
      path: options.customShapeDefinition.path,
      viewBox: options.customShapeDefinition.viewBox,
      fillRule: options.customShapeDefinition.fillRule || 'nonzero',
    }
  }

  const shapeType = options.shapeType || 'circle'
  const shape = BASIC_SHAPES[shapeType] || FONT_AWESOME_SHAPES.get(shapeType)
  if (!shape) {
    throw new Error(`Local Skia renderer does not support shapeType "${shapeType}". Use a supported local shape or provide customShapeDefinition.`)
  }
  return shape
}

function validateSkiaSurfaceSize(options) {
  if (options.format !== 'png') return
  const scale = options.quality === 'hq' ? 4 : 2
  const outputWidth = Math.max(1, Math.round(options.width * scale))
  const outputHeight = Math.max(1, Math.round(options.height * scale))
  const pixels = outputWidth * outputHeight
  if (pixels > MAX_SKIA_OUTPUT_PIXELS) {
    throw new Error(
      `Local Skia PNG would allocate ${outputWidth}x${outputHeight} (${pixels} pixels), above the ${MAX_SKIA_OUTPUT_PIXELS} pixel limit. Lower width/height or use quality: "sq".`,
    )
  }
}

function createShapeMask(shape, width, height) {
  const maskWidth = Math.max(1, Math.round(width))
  const maskHeight = Math.max(1, Math.round(height))
  const transform = computeShapeTransform(shape.viewBox, maskWidth, maskHeight)
  if (!transform) return null

  const canvas = createCanvas(maskWidth, maskHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.setTransform(transform.scale, 0, 0, transform.scale, transform.offsetX, transform.offsetY)
  ctx.fillStyle = '#000'
  ctx.fill(new Path2D(shape.path), shape.fillRule || 'nonzero')
  return erodeShapeMask(ctx.getImageData(0, 0, maskWidth, maskHeight), INTERNAL_SHAPE_GUARD_PX)
}

function computeShapeTransform(viewBoxValue, canvasW, canvasH) {
  const viewBox = parseViewBox(viewBoxValue)
  if (!viewBox || canvasW <= 0 || canvasH <= 0) return null

  const scaleX = (canvasW * (1 - SHAPE_PADDING * 2)) / viewBox.width
  const scaleY = (canvasH * (1 - SHAPE_PADDING * 2)) / viewBox.height
  const scale = Math.min(scaleX, scaleY)
  if (!Number.isFinite(scale) || scale <= 0) return null

  const offsetX = (canvasW - viewBox.width * scale) / 2 - viewBox.minX * scale
  const offsetY = (canvasH - viewBox.height * scale) / 2 - viewBox.minY * scale

  return {
    scale,
    offsetX,
    offsetY,
    minX: viewBox.minX,
    minY: viewBox.minY,
    width: viewBox.width,
    height: viewBox.height,
  }
}

function erodeShapeMask(imageData, radiusPx) {
  if (radiusPx <= 0) return imageData

  const { width, height, data } = imageData
  const sourceAlpha = new Uint8ClampedArray(width * height)
  const targetAlpha = new Uint8ClampedArray(width * height)

  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel++) {
    sourceAlpha[pixel] = data[index + 3]
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x
      if (sourceAlpha[pixelIndex] <= SHAPE_MASK_ALPHA_THRESHOLD) continue

      let keepPixel = true
      for (let offsetY = -radiusPx; offsetY <= radiusPx && keepPixel; offsetY++) {
        const sampleY = y + offsetY
        if (sampleY < 0 || sampleY >= height) {
          keepPixel = false
          break
        }

        for (let offsetX = -radiusPx; offsetX <= radiusPx; offsetX++) {
          const sampleX = x + offsetX
          if (sampleX < 0 || sampleX >= width) {
            keepPixel = false
            break
          }

          if (sourceAlpha[sampleY * width + sampleX] <= SHAPE_MASK_ALPHA_THRESHOLD) {
            keepPixel = false
            break
          }
        }
      }

      if (keepPixel) targetAlpha[pixelIndex] = 255
    }
  }

  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel++) {
    data[index + 3] = targetAlpha[pixel]
  }

  return imageData
}

function buildLayout(coreWords, sourceWords, options, shape) {
  const valueByText = new Map(sourceWords.map((word) => [word.text, word.value]))
  const kindByText = new Map(sourceWords.map((word) => [word.text, word.kind || 'word']))
  const palette = options.palette?.length ? options.palette : DEFAULT_PALETTE
  const words = coreWords.map((word, index) => ({
    ...word,
    kind: word.kind || kindByText.get(word.text) || 'word',
    value: word.value ?? valueByText.get(word.text) ?? 1,
    fill: chooseColor(word, index, palette, options.colorMode),
  }))

  return {
    engine: 'local-skia-shared-core',
    seed: options.seed,
    words,
    shape: {
      id: shape.id,
      viewBox: shape.viewBox,
      fillRule: shape.fillRule || 'nonzero',
    },
  }
}

function chooseColor(word, index, palette, colorMode) {
  if (colorMode === 'byFrequency') {
    return palette[Math.min(palette.length - 1, Math.max(0, word.value - 1) % palette.length)]
  }
  if (colorMode === 'random') {
    return palette[hashString(`${word.text}:${index}`) % palette.length]
  }
  return palette[index % palette.length]
}

function buildSvg(layout, options, shape) {
  const width = options.width
  const height = options.height
  const background = getBackgroundFill(options.background)
  const shapeTransform = computeShapeTransform(shape.viewBox, width, height)
  const clipId = `shape-${hashString(`${shape.id}:${shape.path}:${shape.viewBox}`)}`
  const shapePathTransform = shapeTransform
    ? `translate(${round(shapeTransform.offsetX)} ${round(shapeTransform.offsetY)}) scale(${round(shapeTransform.scale)})`
    : ''
  const strokeWidth = shapeTransform ? 1.1 / shapeTransform.scale : Math.max(1, Math.round(Math.min(width, height) / 360))
  const wordNodes = layout.words.map(renderSvgWord).join('\n      ')
  const watermarkFill = options.background === 'dark' ? '#94a3b8' : '#7c8798'

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="ShapeWords word cloud">`,
    '  <defs>',
    `    <clipPath id="${clipId}">`,
    `      <path d="${escapeXml(shape.path)}" fill-rule="${shape.fillRule || 'nonzero'}" clip-rule="${shape.fillRule || 'nonzero'}" transform="${shapePathTransform}" />`,
    '    </clipPath>',
    '  </defs>',
    background ? `  <rect width="100%" height="100%" fill="${background}" />` : '',
    `  <path d="${escapeXml(shape.path)}" fill="none" stroke="#cbd5e1" stroke-width="${round(strokeWidth)}" opacity="0.72" fill-rule="${shape.fillRule || 'nonzero'}" clip-rule="${shape.fillRule || 'nonzero'}" transform="${shapePathTransform}" />`,
    `  <g clip-path="url(#${clipId})">`,
    `    <g transform="translate(${round(width / 2)} ${round(height / 2)})">`,
    `      ${wordNodes}`,
    '    </g>',
    '  </g>',
    `  <text x="${width - 20}" y="${height - 18}" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="${Math.max(12, Math.round(height * 0.035))}" font-weight="700" fill="${watermarkFill}">${SOURCE_LABEL}</text>`,
    '</svg>',
  ].filter(Boolean).join('\n')
}

function renderSvgWord(word) {
  const rotate = word.kind === 'emoji' ? 0 : word.rotate || 0
  const transform = `translate(${round(word.x)} ${round(word.y)}) rotate(${round(rotate)})`
  if (word.outlinePath) {
    const scale = word.outlineBaseSize && Number.isFinite(word.outlineBaseSize) && word.outlineBaseSize > 0
      ? word.size / word.outlineBaseSize
      : 1
    const pathTransform = Math.abs(scale - 1) > 0.0001 ? ` transform="scale(${round(scale)})"` : ''
    return `<g transform="${transform}"><path d="${escapeXml(word.outlinePath)}"${pathTransform} fill="${escapeXml(word.fill)}" /></g>`
  }

  return `<text x="0" y="0" transform="${transform}" text-anchor="middle" dominant-baseline="central" font-family="${escapeXml(word.font || DEFAULT_FONT_FAMILY)}" font-size="${word.size}" font-weight="${escapeXml(word.fontWeight || DEFAULT_FONT_WEIGHT)}" font-style="${escapeXml(word.fontStyle || DEFAULT_FONT_STYLE)}" fill="${escapeXml(word.fill)}">${escapeXml(word.text)}</text>`
}

function parseViewBox(viewBox) {
  const [minX, minY, width, height] = String(viewBox || '').trim().split(/[,\s]+/).map(Number)
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }

  return { minX, minY, width, height }
}

function getBackgroundFill(background) {
  if (background === 'transparent') return ''
  if (background === 'dark') return DARK_BACKGROUND
  return '#ffffff'
}

function hashString(value) {
  let hash = 2166136261
  for (const char of String(value)) {
    hash ^= char.codePointAt(0) || 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function makeFilename(extension) {
  return `shapewords_skia_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`
}

function escapeXml(value) {
  return String(value).replace(XML_ESCAPE_RE, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[char])
}

function round(value) {
  return Math.round(value * 100) / 100
}
