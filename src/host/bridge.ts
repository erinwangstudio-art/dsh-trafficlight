// host/bridge.ts — exposes the StatusMachine over a fixed loopback port
// (default 18765) as JSON (/state) + SSE (/stream), AND (optionally) under the
// dsh webServer prefix /api/dsh-tl/* for in-page clients. The native macOS
// overlay connects to the standalone port; both share the same snapshot.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import http from 'node:http'
import type { StatusMachine } from './status.ts'

const DEFAULT_PORT = 18_765
const HEARTBEAT_MS = 15_000

// One-shot navigation requests from the native overlay to the DSH web client.
const focusQueue: string[] = []
function requestFocus(sessionId: string, status: StatusMachine): boolean {
  if (!sessionId || !status.subscribedIds().includes(sessionId)) return false
  focusQueue.push(sessionId)
  while (focusQueue.length > 32) focusQueue.shift()
  return true
}
function takeFocusRequest(): string | undefined {
  return focusQueue.shift()
}

/** Read and JSON-parse a request body (small payloads only). */
function readJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    let buf = ''
    let done = false
    const finish = (value: Record<string, unknown> | undefined): void => {
      if (done) return
      done = true
      resolve(value)
    }
    req.on('data', (chunk: Buffer | string) => {
      buf += String(chunk)
      if (buf.length > 64 * 1024) finish(undefined) // oversized → treat as no body
    })
    req.on('end', () => {
      if (done) return
      try {
        const parsed = JSON.parse(buf) as unknown
        finish(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined)
      } catch {
        finish(undefined)
      }
    })
    req.on('error', () => finish(undefined))
  })
}

/** Loopback trust fence — same judgment as the panel system / dsh-ssh. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * Standalone loopback HTTP server. Bound to 127.0.0.1 only, so it is never
 * reachable from the network — the Swift overlay talks to it locally.
 * Returns a disposer.
 */
export function startStandaloneServer(status: StatusMachine, port: number, ctx: Context): () => void {
  const subscribers = new Set<ServerResponse>()
  let timer: ReturnType<typeof setInterval> | undefined

  const broadcast = (): void => {
    const snap = status.snapshot()
    for (const res of subscribers) {
      try {
        res.write('event: trafficlight\ndata: ' + JSON.stringify(snap) + '\n\n')
      } catch {
        /* closed */
      }
    }
  }
  const unsub = status.subscribe(() => {
    broadcast()
    if (subscribers.size > 0 && timer === undefined) {
      timer = setInterval(() => {
        for (const r of subscribers) r.write(': ping\n\n')
      }, HEARTBEAT_MS)
    }
  })

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'GET' && url.pathname === '/state') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(status.snapshot()))
      return
    }
    if (req.method === 'GET' && url.pathname === '/subscriptions') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, value: { subscribed: status.subscribedIds() } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/focus') {
      readJson(req).then((body) => {
        const sessionId = String(body?.sessionId ?? '')
        const accepted = requestFocus(sessionId, status)
        res.writeHead(accepted ? 202 : 404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: accepted }))
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/subscriptions') {
      readJson(req).then((body) => {
        const sessionId = String(body?.sessionId ?? '')
        if (sessionId === '') {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: { code: 'bad-request', message: 'sessionId required' } }))
          return
        }
        const changed = status.subscribeSession(sessionId)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, value: { subscribed: status.subscribedIds(), changed } }))
      })
      return
    }
    if (req.method === 'DELETE' && url.pathname === '/subscriptions') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (sessionId === '') {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: { code: 'bad-request', message: 'sessionId required' } }))
        return
      }
      const changed = status.unsubscribeSession(sessionId)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, value: { subscribed: status.subscribedIds(), changed } }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/opacity') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, value: { opacity: status.snapshot().opacity } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/opacity') {
      readJson(req).then((body) => {
        const accepted = status.setOpacity(body?.opacity)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, value: { opacity: accepted } }))
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/minimal') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, value: { minimalMode: status.snapshot().minimalMode } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/minimal') {
      readJson(req).then((body) => {
        const accepted = status.setMinimalMode(body?.minimalMode)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, value: { minimalMode: accepted } }))
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/mode') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, value: { mode: status.snapshot().mode } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/mode') {
      readJson(req).then((body) => {
        const accepted = status.setMode(body?.mode)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, value: { mode: accepted } }))
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/breath') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      const s = status.snapshot()
      res.end(JSON.stringify({ ok: true, value: { breathCount: s.breathCount, breathBeat: s.breathBeat } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/breath') {
      readJson(req).then((body) => {
        const breathCount = status.setBreathCount(body?.breathCount)
        const breathBeat = status.setBreathBeat(body?.breathBeat)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, value: { breathCount, breathBeat } }))
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write('retry: 2000\n\n')
      res.write('event: trafficlight\ndata: ' + JSON.stringify(status.snapshot()) + '\n\n')
      subscribers.add(res)
      if (timer === undefined) {
        timer = setInterval(() => {
          for (const r of subscribers) r.write(': ping\n\n')
        }, HEARTBEAT_MS)
      }
      req.on('close', () => {
        subscribers.delete(res)
        if (subscribers.size === 0 && timer !== undefined) {
          clearInterval(timer)
          timer = undefined
        }
      })
      return
    }
    res.writeHead(404)
    res.end()
  })

  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    try {
      server.close()
    } catch {
      /* ignore */
    }
    unsub()
    if (timer !== undefined) clearInterval(timer)
    for (const r of subscribers) {
      try {
        r.end()
      } catch {
        /* ignore */
      }
    }
    subscribers.clear()
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      ctx.logger?.warn?.('[dsh-trafficlight] standalone bridge port ' + port + ' in use — only /api/dsh-tl/* web routes will be available.')
    } else {
      ctx.logger?.warn?.('[dsh-trafficlight] bridge error: ' + String(err))
    }
  })
  try {
    server.listen(port, '127.0.0.1', () => {
      ctx.logger?.info?.('[dsh-trafficlight] bridge listening on http://127.0.0.1:' + port)
    })
  } catch (e) {
    ctx.logger?.warn?.('[dsh-trafficlight] could not start bridge: ' + String(e))
  }
  return stop
}

/** Also expose the same snapshot under the dsh webServer for in-page widgets. */
export function registerWebRoutes(ctx: Context, status: StatusMachine): () => void {
  const subscribers = new Set<ServerResponse>()
  let timer: ReturnType<typeof setInterval> | undefined
  const push = (res: ServerResponse, payload: unknown): void => {
    res.write('event: trafficlight\ndata: ' + JSON.stringify(payload) + '\n\n')
  }
  const broadcast = (): void => {
    const s = status.snapshot()
    for (const r of subscribers) {
      try {
        push(r, s)
      } catch {
        /* closed */
      }
    }
  }
  const unsub = status.subscribe(() => {
    broadcast()
    if (subscribers.size > 0 && timer === undefined) {
      timer = setInterval(() => {
        for (const r of subscribers) r.write(': ping\n\n')
      }, HEARTBEAT_MS)
    }
  })

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isLoopbackRequest(req)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'loopback-only' } }))
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'GET' && url.pathname === '/api/dsh-tl/state') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, value: status.snapshot() }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/dsh-tl/subscriptions') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, value: { subscribed: status.subscribedIds() } }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/dsh-tl/focus') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, value: { sessionId: takeFocusRequest() ?? null } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/dsh-tl/focus') {
      const body = await readJson(req)
      const sessionId = String(body?.sessionId ?? '')
      const accepted = sessionId !== '' && requestFocus(sessionId, status)
      res.writeHead(accepted ? 202 : 404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: accepted }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/dsh-tl/dockbeat') {
      status.noteDockBeat()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/dsh-tl/subscriptions') {
      const body = await readJson(req)
      const sessionId = String(body?.sessionId ?? '')
      if (sessionId === '') {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: { code: 'bad-request', message: 'sessionId required' } }))
        return
      }
      const changed = status.subscribeSession(sessionId)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, value: { subscribed: status.subscribedIds(), changed } }))
      return
    }
    if (req.method === 'DELETE' && url.pathname === '/api/dsh-tl/subscriptions') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (sessionId === '') {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: { code: 'bad-request', message: 'sessionId required' } }))
        return
      }
      const changed = status.unsubscribeSession(sessionId)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, value: { subscribed: status.subscribedIds(), changed } }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/dsh-tl/opacity') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, value: { opacity: status.snapshot().opacity } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/dsh-tl/opacity') {
      const body = await readJson(req)
      const accepted = status.setOpacity(body?.opacity)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, value: { opacity: accepted } }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/dsh-tl/minimal') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, value: { minimalMode: status.snapshot().minimalMode } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/dsh-tl/minimal') {
      const body = await readJson(req)
      const accepted = status.setMinimalMode(body?.minimalMode)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, value: { minimalMode: accepted } }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/dsh-tl/mode') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, value: { mode: status.snapshot().mode } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/dsh-tl/mode') {
      const body = await readJson(req)
      const accepted = status.setMode(body?.mode)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, value: { mode: accepted } }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/dsh-tl/breath') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      const s = status.snapshot()
      res.end(JSON.stringify({ ok: true, value: { breathCount: s.breathCount, breathBeat: s.breathBeat } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/dsh-tl/breath') {
      const body = await readJson(req)
      const breathCount = status.setBreathCount(body?.breathCount)
      const breathBeat = status.setBreathBeat(body?.breathBeat)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, value: { breathCount, breathBeat } }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/dsh-tl/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write('retry: 2000\n\n')
      push(res, status.snapshot())
      subscribers.add(res)
      if (timer === undefined) {
        timer = setInterval(() => {
          for (const r of subscribers) r.write(': ping\n\n')
        }, HEARTBEAT_MS)
      }
      req.on('close', () => {
        subscribers.delete(res)
        if (subscribers.size === 0 && timer !== undefined) {
          clearInterval(timer)
          timer = undefined
        }
      })
      return
    }
    res.writeHead(405)
    res.end()
  }

  const off = ctx.webServer.register({ kind: 'prefix', path: '/api/dsh-tl', handler })
  return () => {
    try {
      off()
    } catch {
      /* ignore */
    }
    unsub()
    if (timer !== undefined) clearInterval(timer)
    for (const r of subscribers) {
      try {
        r.end()
      } catch {
        /* ignore */
      }
    }
    subscribers.clear()
  }
}
