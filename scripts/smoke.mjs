import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: 'node',
  args: ['src/index.js'],
  cwd: new URL('..', import.meta.url).pathname,
  stderr: 'pipe',
  env: {
    SHAPEWORDS_API_BASE_URL: process.env.SHAPEWORDS_API_BASE_URL || 'https://shapewords.fun',
    SHAPEWORDS_POLL_TIMEOUT_MS: '120000',
  },
})

const stderr = transport.stderr
if (stderr) {
  stderr.on('data', (chunk) => process.stderr.write(chunk))
}

const client = new Client({
  name: 'shapewords-mcp-smoke',
  version: '0.2.1',
})

try {
  await client.connect(transport)
  const tools = await client.listTools()
  const names = tools.tools.map((tool) => tool.name)
  console.log(`tools: ${names.join(', ')}`)

  if (!names.includes('render_word_cloud')) {
    throw new Error('render_word_cloud is missing.')
  }

  const result = await client.callTool({
    name: 'render_word_cloud',
    arguments: {
      text: 'MCP smoke test ShapeWords word cloud API render tools protocol integration',
      locale: 'en',
      format: 'svg',
      width: 720,
      height: 480,
      background: 'white',
      quality: 'sq',
      engine: 'auto',
      returnLayout: true,
      shapeType: 'circle',
      maxWords: 40,
      seed: 12345,
      palette: ['#7c3aed', '#14b8a6', '#111827'],
      returnImage: false,
    },
  })

  console.log(result.content?.[0]?.text || 'tool call completed')
} finally {
  await client.close()
}
