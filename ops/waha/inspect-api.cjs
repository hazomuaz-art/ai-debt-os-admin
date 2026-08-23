const fs = require('node:fs')

const env = Object.fromEntries(
  fs.readFileSync(process.argv[2], 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')]
    })
)

async function main() {
  const baseUrl = env.WAHA_API_URL.replace(/\/$/, '')
  const headers = { 'X-Api-Key': env.WAHA_API_KEY }
  for (const candidate of ['/docs-json', '/api-json', '/swagger-json', '/openapi.json']) {
    const response = await fetch(`${baseUrl}${candidate}`, { headers })
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok || !contentType.includes('json')) {
      console.log(JSON.stringify({ path: candidate, status: response.status }))
      continue
    }
    const document = await response.json()
    const sessionPaths = Object.fromEntries(
      Object.entries(document.paths || {})
        .filter(([path]) => path.includes('/sessions'))
        .map(([path, operations]) => [path, Object.keys(operations)])
    )
    console.log(JSON.stringify({ path: candidate, status: response.status, session_paths: sessionPaths }))
    return
  }
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
