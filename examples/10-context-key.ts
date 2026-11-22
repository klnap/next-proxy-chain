import { chain, contextKey, defineProxy, next } from '@klnap/next-proxy-chain'
import { NextResponse } from 'next/server'

type Session = { user: string }

// Declare the key once, at module level. It is typed and private to this declaration.
const session = contextKey<Session>('session')

// This rule creates the value and stores it for the rest of the chain.
const readSession = defineProxy('read-session', (req, ctx) => {
  const user = req.cookies.get('user')?.value
  if (user) session.set(ctx, { user })
  return next()
})

// A later rule reads it. No createContext is needed.
const requireUser = defineProxy('require-user', (req, ctx) => {
  if (!session.get(ctx)) return NextResponse.redirect(new URL('/login', req.url))
  return next()
})

export default chain([readSession, [requireUser, '/dashboard/**']])
