import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: 'node',
  args: ['src/index.js'],
  cwd: new URL('..', import.meta.url).pathname,
  stderr: 'pipe',
})

const stderr = transport.stderr
if (stderr) {
  stderr.on('data', (chunk) => process.stderr.write(chunk))
}

const client = new Client({
  name: 'shapewords-mcp-skia-smoke',
  version: '0.2.1',
})

try {
  await client.connect(transport)
  const result = await client.callTool({
    name: 'render_word_cloud',
    arguments: {
      engine: 'skia',
      format: 'png',
      width: 420,
      height: 300,
      background: 'white',
      quality: 'sq',
      shapeType: 'cloud',
      maxWords: 40,
      seed: 12345,
      palette: ['#7c3aed', '#14b8a6', '#111827'],
      words: [
        { text: 'MCP', value: 12 },
        { text: 'ShapeWords', value: 10 },
        { text: 'Skia', value: 8 },
        { text: 'CanvasKit', value: 7 },
        { text: 'local', value: 6 },
        { text: 'renderer', value: 5 },
        { text: 'layout', value: 4 },
      ],
    },
  })

  const image = result.content?.find((item) => item.type === 'image')
  if (!image || image.mimeType !== 'image/png' || !image.data) {
    throw new Error('Local Skia smoke did not return an inline PNG image.')
  }

  const bytes = Buffer.from(image.data, 'base64')
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('Local Skia smoke returned bytes without a PNG signature.')
  }

  const artifact = result.structuredContent?.localArtifact
  console.log(`local skia png: ${artifact?.width}x${artifact?.height}, ${bytes.length} bytes`)
} finally {
  await client.close()
}
