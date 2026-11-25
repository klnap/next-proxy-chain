import { chain as composeChain, defineHandler, next } from '@klnap/next-proxy-chain'
import { NextResponse } from 'next/server'

type Session = { user: string }

// Sets a value. Later rules in the chain can read it.
const readSession = defineHandler({
  name: 'read-session',
  handler: (req, _event, ctx) => {
    const user = req.cookies.get('user')?.value
    if (user) ctx.set('session', { user })
    return next()
  },
})

// Reads the value back.
const requireUser = defineHandler({
  name: 'require-user',
  handler: (req, _event, ctx) => {
    const session = ctx.get('session') as Session | undefined
    if (!session) return NextResponse.redirect(new URL('/login', req.url))
    return next()
  },
})

export default composeChain([readSession, [requireUser, '/dashboard/**']])
