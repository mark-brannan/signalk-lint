import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ConfigDirError,
  ConfigDirErrorCode,
  assertConfigDir
} from '../src/config-dir.js'

/** The rejection code, or null if the path was accepted. */
function rejectionCode(path: string): ConfigDirErrorCode | null {
  try {
    assertConfigDir(path)
    return null
  } catch (error) {
    if (error instanceof ConfigDirError) return error.code
    throw error
  }
}

describe('assertConfigDir()', () => {
  it('accepts an existing directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sk-lint-'))
    expect(rejectionCode(dir)).toBeNull()
  })

  it('rejects a path that does not exist', () => {
    // The whole point: without this the collector returns nulls, every rule
    // reports "could not evaluate", and the run exits 0 -- a clean pass over
    // a config directory that was never there.
    expect(rejectionCode('/nonexistent/path/xyz')).toBe('missing')
  })

  it('rejects a file where a directory was expected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sk-lint-'))
    const file = join(dir, 'settings.json')
    await writeFile(file, '{}')
    // Pointing at settings.json instead of the directory holding it is the
    // likely typo, and it degrades exactly the same way.
    expect(rejectionCode(file)).toBe('not-a-directory')
  })
})
