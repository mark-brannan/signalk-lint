/**
 * Rule: config/allow-readonly-non-loopback
 *
 * Allowing unauthenticated read access is reasonable when you are alone at
 * anchor. It is a data leak on marina wifi or any shared network. This rule
 * flags the *combination* of allow_readonly: true and a non-loopback binding.
 *
 * The binding address comes from settings.json's `server.listen` field. Typical
 * values are 0.0.0.0 (all interfaces), 192.168.1.50 (LAN), 127.0.0.1 (loopback,
 * local only), or ::1 (IPv6 loopback).
 *
 * Only 127.0.0.1 and ::1 are truly safe; everything else includes your LAN.
 *
 * Provenance: convention (this is widespread practice in the Signal K community,
 * though not formally specified).
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'

function isLoopback(addr: string | null): boolean {
  if (addr === null) return false
  // Normalize to lowercase for comparison
  const normalized = addr.toLowerCase()
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1'
  )
}

export const allowReadonlyNonLoopback: Rule = {
  id: 'config/allow-readonly-non-loopback',
  description:
    'Unauthenticated read access is enabled on a non-loopback interface',
  defaultSeverity: 'warn',
  provenance: 'convention',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const security = snapshot.server.security

    // No security.json means the server is running with defaults, which do
    // not include allow_readonly. Nothing to flag here.
    if (security === null) {
      return []
    }

    // Rule only fires if readonly is explicitly allowed.
    if (security.allowReadonly !== true) {
      return []
    }

    const settings = snapshot.server.settings

    // settings.json missing is not the same as "safe" -- it means we cannot
    // tell what interface the server is bound to. Silently passing here would
    // be the worst failure mode for a security rule: it looks clean on a
    // server that may be wide open. Report the gap instead of hiding it.
    if (settings === null) {
      return [
        {
          title: 'Unauthenticated read access is on, binding unknown',
          detail:
            'You have allow_readonly set to true, but settings.json is ' +
            'missing or unreadable, so this rule cannot tell whether the ' +
            'server is bound to loopback only or to the network. Signal K ' +
            'defaults to listening on all interfaces, so treat this as ' +
            'likely-network-exposed until confirmed otherwise.',
          evidence: [
            { path: 'server.security.allowReadonly', value: true },
            { path: 'server.settings', value: null }
          ],
          severity: 'warn',
          remediation: {
            kind: 'manual',
            description:
              'Check Server → Settings for the listen address. If it is not ' +
              '127.0.0.1, either disable allow_readonly or restrict the ' +
              'binding.'
          }
        }
      ]
    }

    // Now check the binding address. It's in settings.server.listen.
    // settings.server is an object; settings.server.listen is the address string.
    const serverConfig = settings.server as Record<string, unknown> | undefined
    const listenAddr = serverConfig?.listen as string | undefined | null

    if (isLoopback(listenAddr ?? null)) {
      // It's bound to loopback, so readonly access is only local. Safe.
      return []
    }

    // readonly is on, and we're listening on a non-loopback address.
    return [
      {
        title: 'Unauthenticated read access on a network interface',
        detail:
          'You have allow_readonly set to true, and the server is listening ' +
          `on ${listenAddr ?? 'all interfaces (0.0.0.0)'}. This means any device on your ` +
          'network can read the entire data model — position, depth, battery, ' +
          'engine telemetry, everything — without logging in. This is fine at ' +
          'anchor in the middle of the ocean. On marina wifi or any shared ' +
          'network, it is a data leak.',
        evidence: [
          { path: 'server.security.allowReadonly', value: true },
          {
            path: 'server.settings.server.listen',
            value: listenAddr ?? '0.0.0.0'
          }
        ],
        severity: 'warn',
        remediation: {
          kind: 'manual',
          description:
            'Either disable allow_readonly (in Settings → Security), or bind ' +
            'to 127.0.0.1 only (in Settings → Server). If you need network ' +
            'access, require authentication instead of allowing readonly.'
        }
      }
    ]
  }
}
