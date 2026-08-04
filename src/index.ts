/**
 * Signal K plugin entry point.
 *
 * The plugin is a *surface*, not the product. All it does is capture a
 * snapshot, hand it to the pure lint core, and expose the results. Every line
 * of judgement lives in src/rules, where it can be tested without a server.
 *
 * Running in-process is the whole reason this tool can see what it sees: the
 * REST API shows you the data model, but settings.json, security.json and
 * priorities.json are only visible from inside.
 */
import { IRouter } from 'express'
import { Plugin, ServerAPI } from '@signalk/server-api'
import { collect } from './collect/index.js'
import { lint } from './lint.js'
import { rules } from './rules/index.js'
import { LintConfig, LintResult } from './types.js'

interface Options {
  /** How often to re-run the rule set. Config changes rarely; this is cheap. */
  intervalMinutes: number
  /** Mirror error/warn findings into notifications.* so alarm panels see them. */
  publishNotifications: boolean
}

const DEFAULTS: Options = {
  intervalMinutes: 60,
  publishNotifications: false
}

/**
 * The server passes an `app` with more on it than @signalk/server-api types.
 * `config.version` is the installed server version and is what rule
 * `server/known-vulnerability` needs, so we reach for it deliberately and
 * narrowly rather than typing the whole untyped surface.
 */
interface ServerInternals {
  config?: { version?: string }
}

export default function (app: ServerAPI): Plugin {
  let timer: NodeJS.Timeout | undefined
  let latest: LintResult | undefined

  async function run(): Promise<void> {
    try {
      const configDir = app.getDataDirPath()
      const serverVersion =
        (app as unknown as ServerInternals).config?.version ?? null

      const snapshot = await collect({ configDir, serverVersion })
      const config: LintConfig = {}
      latest = lint(snapshot, config)

      const errors = latest.findings.filter(
        (f) => f.severity === 'error'
      ).length
      const warnings = latest.findings.filter(
        (f) => f.severity === 'warn'
      ).length

      app.setPluginStatus(
        latest.findings.length === 0
          ? 'No findings'
          : `${latest.findings.length} finding(s): ${errors} error, ${warnings} warn`
      )
    } catch (error) {
      // A linter that takes the server down has failed at its actual job.
      app.setPluginError(`lint run failed: ${(error as Error).message}`)
    }
  }

  const plugin: Plugin = {
    id: 'signalk-lint',
    name: 'Lint',
    description:
      'Checks this Signal K installation against a set of deterministic rules.',

    schema: () => ({
      type: 'object',
      properties: {
        intervalMinutes: {
          type: 'number',
          title: 'Minutes between lint runs',
          default: DEFAULTS.intervalMinutes,
          minimum: 1
        },
        publishNotifications: {
          type: 'boolean',
          title:
            'Publish error findings as Signal K notifications (visible to alarm panels)',
          default: DEFAULTS.publishNotifications
        }
      }
    }),

    start: (options: Partial<Options>) => {
      const opts = { ...DEFAULTS, ...options }
      void run()
      timer = setInterval(() => void run(), opts.intervalMinutes * 60_000)
    },

    stop: () => {
      if (timer) clearInterval(timer)
      timer = undefined
      latest = undefined
    },

    registerWithRouter: (router: IRouter) => {
      router.get('/findings', (_req, res) => {
        if (!latest) {
          res.status(503).json({ error: 'no lint run has completed yet' })
          return
        }
        res.json({ findings: latest.findings, skipped: latest.skipped })
      })

      router.get('/snapshot', (_req, res) => {
        if (!latest) {
          res.status(503).json({ error: 'no lint run has completed yet' })
          return
        }
        res.json(latest.snapshot)
      })

      router.get('/rules', (_req, res) => {
        res.json(
          rules.map((r) => ({
            id: r.id,
            description: r.description,
            defaultSeverity: r.defaultSeverity,
            provenance: r.provenance
          }))
        )
      })
    }
  }

  return plugin
}

// Re-exported so other packages can consume the engine directly without
// going through the plugin.
export { collect } from './collect/index.js'
export { lint, hasErrors, PRESETS } from './lint.js'
export { rules } from './rules/index.js'
export * from './types.js'
