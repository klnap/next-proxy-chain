import { chain, defineProxy, next } from '@klnap/next-proxy-chain'
import { NextResponse } from 'next/server'

type Session = { user: string }

// Sets a value. Later rules in the chain can read it.
const readSession = defineProxy('read-session', (req, ctx) => {
  const user = req.cookies.get('user')?.value
  if (user) ctx.set('session', { user })
  return next()
})

// Reads the value back.
const requireUser = defineProxy('require-user', (req, ctx) => {
  const session = ctx.get('session') as Session | undefined
  if (!session) return NextResponse.redirect(new URL('/login', req.url))
  return next()
})

export default chain([readSession, [requireUser, '/dashboard/**']])
