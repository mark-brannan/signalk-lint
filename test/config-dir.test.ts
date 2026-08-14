import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertConfigDir } from '../src/config-dir.js'

describe('assertConfigDir()', () => {
  it('accepts an existing directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sk-lint-'))
    expect(() => assertConfigDir(dir)).not.toThrow()
  })

  it('rejects a path that does not exist', () => {
    // The whole point: without this the collector returns nulls, every rule
    // reports "could not evaluate", and the run exits 0 -- a clean pass over
    // a config directory that was never there.
    expect(() => assertConfigDir('/nonexistent/path/xyz')).toThrow(
      /Config directory not found/
    )
  })

  it('rejects a file where a directory was expected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sk-lint-'))
    const file = join(dir, 'settings.json')
    await writeFile(file, '{}')
    // Pointing at settings.json instead of the directory holding it is the
    // likely typo, and it degrades exactly the same way.
    expect(() => assertConfigDir(file)).toThrow(/Not a directory/)
  })
})
