/**
 * Shared narrowing for settings.json's `pipedProviders`.
 *
 * `server.settings` is a raw `Record<string, unknown>` -- the collector reads
 * settings.json verbatim and deliberately keeps plugin- and provider-specific
 * knowledge out of itself. That leaves the narrowing to rules, and more than
 * one rule now needs the same question answered ("is there a real instrument
 * feeding this server?"), so the shape lives here once rather than being
 * re-derived per rule.
 *
 * Shapes verified against a live settings.json and @signalk/streams:
 *
 *   pipedProviders: [
 *     {
 *       id: "n2k-can0",
 *       enabled: true,
 *       pipeElements: [
 *         {
 *           type: "providers/simple",
 *           options: {
 *             type: "NMEA2000",
 *             subOptions: { type: "canbus-canboatjs", interface: "can0" }
 *           }
 *         }
 *       ]
 *     }
 *   ]
 *
 * `options.type` is the protocol ("NMEA2000", "NMEA0183", "SignalK",
 * "FileStream"); `options.subOptions.type` is the transport underneath it
 * ("canbus-canboatjs", "serial", "ntp"...).
 */
import { Snapshot } from '../types.js'

export interface PipeElementOptions {
  /** Protocol: "NMEA2000", "NMEA0183", "SignalK", "FileStream". */
  type?: string
  /**
   * Serial device path, on a `providers/serialport` pipe element. Verified
   * against @signalk/streams' serialport.js.
   */
  device?: string
  /**
   * Transport beneath the protocol, e.g. { type: "canbus-canboatjs",
   * interface: "can0" }. `interface` names the CAN interface for canbus
   * transports, verified against the same live settings.json as the shape
   * above.
   */
  subOptions?: { type?: string; interface?: string }
}

export interface PipeElement {
  type?: string
  options?: PipeElementOptions
}

export interface PipedProvider {
  id?: string
  enabled?: boolean
  pipeElements?: PipeElement[]
}

/**
 * The protocols that carry instrument data off a boat's own wiring.
 *
 * Deliberately does NOT include "SignalK" (an upstream Signal K server) or
 * "FileStream" (log playback). Both can legitimately carry real data, so a
 * rule keying off this set is asking specifically "is a physical NMEA bus or
 * instrument wired in", not "is any data arriving at all" -- and must say so
 * in its finding rather than implying the broader claim.
 */
const NMEA_PROTOCOLS = new Set(['NMEA2000', 'NMEA0183'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a value is shaped like a provider entry well enough to read.
 *
 * This is not schema validation -- it is the narrow guarantee callers need in
 * order not to throw. settings.json is a file on a boat: hand-edited, restored
 * from a half-finished backup, written by a script someone wrote once. A rule
 * that throws on a malformed entry does not just fail itself, it takes down
 * the whole lint run, because lint() evaluates every rule in one pass. The
 * collector's rule -- half a snapshot is useful, a crash is not -- has to hold
 * here too.
 */
function isPipedProvider(value: unknown): value is PipedProvider {
  if (!isObject(value)) return false

  const elements = value.pipeElements
  if (elements === undefined) return true
  if (!Array.isArray(elements)) return false

  return elements.every(
    (element) =>
      isObject(element) &&
      (element.options === undefined || isObject(element.options))
  )
}

/**
 * The configured providers, or null when the question can't be answered.
 *
 * Three inputs, three different answers:
 *
 *   absent key      -> []    signalk-server materialises an empty array for
 *                            it in readSettingsFile(), so "no connections"
 *                            is the literal truth, not an inference.
 *   `[]`            -> []    same state, written out.
 *   null / not an   -> null  malformed settings.json. signalk-server only
 *   array / entries          substitutes for `undefined`, so an explicit
 *   that aren't               null survives to its own `.forEach` and breaks
 *   readable                  the server. "No connections are configured" is
 *                             the wrong thing to tell someone whose config
 *                             file is broken -- and a rule cannot report on
 *                             entries it cannot read without guessing.
 */
export function pipedProvidersOf(snapshot: Snapshot): PipedProvider[] | null {
  const settings = snapshot.server.settings
  if (settings === null) return null

  const providers = settings.pipedProviders
  if (providers === undefined) return []
  if (!Array.isArray(providers)) return null
  if (!providers.every(isPipedProvider)) return null

  return providers
}

/**
 * True when the provider is switched on. A provider with `enabled: false` is
 * saved config that isn't running, so it feeds nothing.
 *
 * Absent `enabled` is treated as on: this reads saved config written by other
 * tools and hands, and refusing to count a provider because a key is missing
 * would false-positive the rules that ask "is anything feeding this server".
 */
export function isEnabled(provider: PipedProvider): boolean {
  return provider.enabled !== false
}

/** The NMEA protocols this provider carries, in pipe-element order. */
export function nmeaProtocolsOf(provider: PipedProvider): string[] {
  const elements = provider.pipeElements
  if (!Array.isArray(elements)) return []

  return elements
    .map((element) => element.options?.type)
    .filter(
      (type): type is string =>
        typeof type === 'string' && NMEA_PROTOCOLS.has(type)
    )
}

/** True when the provider is enabled and carries NMEA 0183 or NMEA 2000. */
export function isNmeaInput(provider: PipedProvider): boolean {
  return isEnabled(provider) && nmeaProtocolsOf(provider).length > 0
}

/**
 * A provider reduced to the values worth putting in a finding's evidence:
 * what it is called, whether it is on, and what it actually carries.
 *
 * Evidence has to survive being read by someone who does not have the config
 * in front of them, so this keeps real values rather than a summary sentence.
 */
export function describeProvider(provider: PipedProvider): {
  id: string
  enabled: boolean
  protocols: string[]
} {
  const elements = Array.isArray(provider.pipeElements)
    ? provider.pipeElements
    : []
  return {
    id: typeof provider.id === 'string' ? provider.id : '(unnamed connection)',
    enabled: isEnabled(provider),
    protocols: elements
      .map((element) => element.options?.type)
      .filter((type): type is string => typeof type === 'string')
  }
}
