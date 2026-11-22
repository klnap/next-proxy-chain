import { describe, expect, it } from 'bun:test'
import { NextRequest } from 'next/server'
import contextKeyExample from '../../examples/10-context-key'

describe('README contextKey example', () => {
  it('redirects a visitor without a session cookie', async () => {
    const res = await contextKeyExample(
      new NextRequest('http://localhost/dashboard/home'),
      {} as never
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/login')
  })

  it('lets a visitor with a session cookie through', async () => {
    const req = new NextRequest('http://localhost/dashboard/home', {
      headers: { cookie: 'user=ada' },
    })
    const res = await contextKeyExample(req, {} as never)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
})
