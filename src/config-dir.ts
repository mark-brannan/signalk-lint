/**
 * Validation of a config directory the user named.
 *
 * Lives in its own module rather than in cli.ts because cli.ts runs `main()` on
 * import and so cannot be unit tested.
 */
import { statSync } from 'node:fs'

/**
 * Why a config directory was rejected.
 *
 * A code rather than a message so that callers and tests can tell the two cases
 * apart without matching on wording -- the same reason findings carry evidence
 * paths instead of prose.
 */
export type ConfigDirErrorCode = 'missing' | 'not-a-directory'

export class ConfigDirError extends Error {
  constructor(
    readonly code: ConfigDirErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ConfigDirError'
  }
}

/**
 * A config directory the user named is a boundary, so it is validated before
 * anything reads it rather than left to the collector.
 *
 * Collectors are forgiving on purpose: an unreadable file yields null so that
 * half a snapshot is still useful. That is right for a file inside a real
 * installation and wrong for the directory itself -- every read fails, every
 * rule reports "could not evaluate", and the run exits 0 because nothing
 * reached error severity. A clean pass over a path that does not exist is the
 * exact failure this tool exists to not have.
 */
export function assertConfigDir(configDir: string): void {
  let isDirectory: boolean
  try {
    isDirectory = statSync(configDir).isDirectory()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // ENOTDIR means a path component is a file -- ~/.signalk/settings.json
    // passed where ~/.signalk was meant. That is the same mistake as pointing
    // at a file directly, so it gets the same answer.
    if (code === 'ENOTDIR') {
      throw new ConfigDirError(
        'not-a-directory',
        `Not a directory: ${configDir}`
      )
    }
    if (code !== 'ENOENT') {
      // A permission error is not a missing directory, and saying "not found"
      // would send someone looking for the wrong problem. Let it through with
      // its own message; the CLI still exits 2 either way.
      throw error
    }
    throw new ConfigDirError(
      'missing',
      `Config directory not found: ${configDir}\n` +
        'Pass --config-dir <path>, or --snapshot <file> to lint a captured snapshot.'
    )
  }
  if (!isDirectory) {
    throw new ConfigDirError('not-a-directory', `Not a directory: ${configDir}`)
  }
}
