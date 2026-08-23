import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_REDIRECTS = 3

export class UnsafeIntegrationUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeIntegrationUrlError'
  }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0]
  return value === '::' || value === '::1' || value.startsWith('fc') ||
    value.startsWith('fd') || /^fe[89ab]/.test(value) ||
    value.startsWith('ff') || value.startsWith('2001:db8:') ||
    (value.startsWith('::ffff:') && isPrivateIpv4(value.slice(7)))
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) return isPrivateIpv6(address)
  return true
}

function allowedHosts(): Set<string> {
  return new Set(
    String(process.env.INTEGRATION_ALLOWED_HOSTS ?? '')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean),
  )
}

type AddressResolver = (hostname: string) => Promise<Array<{ address: string }>>

const systemResolver: AddressResolver = hostname => lookup(hostname, { all: true, verbatim: true })

export async function validateIntegrationUrl(rawUrl: string, resolveAddresses: AddressResolver = systemResolver): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeIntegrationUrlError('Integration URL is invalid')
  }

  if (url.username || url.password) {
    throw new UnsafeIntegrationUrlError('Credentials in integration URLs are not allowed')
  }

  const allowHttp = process.env.ALLOW_INSECURE_INTEGRATION_HTTP === 'true' && process.env.NODE_ENV !== 'production'
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new UnsafeIntegrationUrlError('Integration URL must use HTTPS')
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const hosts = allowedHosts()
  if (process.env.NODE_ENV === 'production' && (hosts.size === 0 || !hosts.has(hostname))) {
    throw new UnsafeIntegrationUrlError('Integration host is not present in INTEGRATION_ALLOWED_HOSTS')
  }
  if (hosts.size > 0 && !hosts.has(hostname)) {
    throw new UnsafeIntegrationUrlError('Integration host is not allowlisted')
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new UnsafeIntegrationUrlError('Private integration hosts are not allowed')
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await resolveAddresses(hostname).catch(() => {
        throw new UnsafeIntegrationUrlError('Integration host could not be resolved')
      })

  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new UnsafeIntegrationUrlError('Integration host resolves to a private or reserved network')
  }

  return url
}

export async function safeIntegrationFetch(
  rawUrl: string,
  options: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  let currentUrl = rawUrl

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const validated = await validateIntegrationUrl(currentUrl)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await fetch(validated, {
        ...options,
        redirect: 'manual',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (!location) throw new UnsafeIntegrationUrlError('Integration redirect has no location')
    if (redirects === MAX_REDIRECTS) throw new UnsafeIntegrationUrlError('Too many integration redirects')
    const nextUrl = new URL(location, validated)
    // Never forward bearer/API-key headers to another origin through a
    // redirect, even when both hosts happen to be allowlisted.
    if (nextUrl.origin !== validated.origin) {
      throw new UnsafeIntegrationUrlError('Cross-origin integration redirects are not allowed')
    }
    currentUrl = nextUrl.toString()
  }

  throw new UnsafeIntegrationUrlError('Too many integration redirects')
}
