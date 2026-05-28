import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { generateNegotiationResponse } from '@/lib/negotiation-response'

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    let body: { message?: string }

    try {
      body = await req.json()
    } catch {
      return errors.badRequest('Invalid JSON')
    }

    if (!body.message) {
      return errors.badRequest('message required')
    }

    const result = generateNegotiationResponse(body.message)

    return NextResponse.json({
      data: result
    })
  })
}
