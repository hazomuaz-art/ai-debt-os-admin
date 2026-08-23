const fs = require('node:fs')

function readEnv(file) {
  const values = {}
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

async function main() {
  const envFile = process.argv[2]
  const qrFile = process.argv[3]
  const forceRelink = process.argv.includes('--force-relink')
  const forceRecreate = process.argv.includes('--force-recreate')
  if (!envFile || !qrFile) throw new Error('Usage: recover-session.cjs ENV_FILE QR_OUTPUT')

  const env = readEnv(envFile)
  const baseUrl = (env.WAHA_API_URL || '').replace(/\/$/, '')
  const apiKey = env.WAHA_API_KEY || ''
  const session = env.WAHA_SESSION || 'default'
  if (!baseUrl || !apiKey) throw new Error('WAHA configuration is incomplete')

  const headers = { 'X-Api-Key': apiKey }
  const sessionUrl = `${baseUrl}/api/sessions/${encodeURIComponent(session)}`
  const current = await fetch(sessionUrl, { headers })
  const currentBody = current.ok ? await current.json() : null

  let start
  if (forceRecreate && currentBody) {
    await fetch(`${sessionUrl}/stop`, { method: 'POST', headers })
    const deletion = await fetch(sessionUrl, { method: 'DELETE', headers })
    if (!deletion.ok && deletion.status !== 404) {
      throw new Error(`WAHA session deletion failed with HTTP ${deletion.status}`)
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
    start = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: session, config: currentBody.config || {}, start: true }),
    })
  } else {
    if (currentBody?.status === 'FAILED') {
      await fetch(`${sessionUrl}/stop`, { method: 'POST', headers })
      await new Promise(resolve => setTimeout(resolve, 1500))
    }

    start = await fetch(`${sessionUrl}/start`, {
      method: 'POST',
      headers,
    })
  }

  if (!start.ok) {
    throw new Error(`WAHA session start failed with HTTP ${start.status}`)
  }

  let state = 'UNKNOWN'
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    const response = await fetch(sessionUrl, { headers })
    if (response.ok) {
      const body = await response.json()
      state = body.status || 'UNKNOWN'
      if (state === 'WORKING' || state === 'SCAN_QR_CODE') break
    }
  }

  if (state === 'FAILED' && forceRelink) {
    const logout = await fetch(`${sessionUrl}/logout`, { method: 'POST', headers })
    if (!logout.ok && logout.status !== 404) {
      throw new Error(`WAHA logout failed with HTTP ${logout.status}`)
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
    const relinkStart = await fetch(`${sessionUrl}/start`, { method: 'POST', headers })
    if (!relinkStart.ok) throw new Error(`WAHA relink start failed with HTTP ${relinkStart.status}`)

    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const response = await fetch(sessionUrl, { headers })
      if (!response.ok) continue
      const body = await response.json()
      state = body.status || 'UNKNOWN'
      if (state === 'WORKING' || state === 'SCAN_QR_CODE') break
    }
  }

  let qrWritten = false
  if (state !== 'WORKING') {
    const qr = await fetch(`${baseUrl}/api/${encodeURIComponent(session)}/auth/qr?format=image`, { headers })
    if (qr.ok && (qr.headers.get('content-type') || '').startsWith('image/')) {
      fs.writeFileSync(qrFile, Buffer.from(await qr.arrayBuffer()), { mode: 0o600 })
      qrWritten = true
    }
  }

  console.log(JSON.stringify({ start_http_status: start.status, session_status: state, qr_written: qrWritten }))
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
