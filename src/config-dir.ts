/**
 * Validation of a config directory the user named.
 *
 * Lives in its own module rather than in cli.ts because cli.ts runs `main()` on
 * import and so cannot be unit tested.
 */
import { statSync } from 'node:fs'

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
  } catch {
    throw new Error(
      `Config directory not found: ${configDir}\n` +
        'Pass --config-dir <path>, or --snapshot <file> to lint a captured snapshot.'
    )
  }
  if (!isDirectory) {
    throw new Error(`Not a directory: ${configDir}`)
  }
}
