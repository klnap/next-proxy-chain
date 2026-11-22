import { chain, defineProxy, next } from '@klnap/next-proxy-chain'
import type { NextRequest } from 'next/server'

// 1. Say what the context looks like.
type Ctx = { requestId: string; user?: string }

// 2. Create it at the start of every request.
const createContext = (req: NextRequest): Ctx => ({
  requestId: req.headers.get('x-request-id') ?? crypto.randomUUID(),
})

// 3. A rule that reads the context.
const readSession = defineProxy<Ctx>('read-session', (req, ctx) => {
  ctx.user = req.cookies.get('user')?.value
  return next({ headers: { 'x-request-id': ctx.requestId } })
})

export default chain([readSession], { createContext })
