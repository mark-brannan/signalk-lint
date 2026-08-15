/**
 * Copies the root icon.svg into public/ so the admin Webapps page has
 * something to serve at the path its `appIcon` points to.
 *
 * A symlink cannot do this job: npm's packlist skips symlinked files rather
 * than following them, so a symlinked public/icon.svg is simply absent from
 * the published tarball and the Webapps page renders a broken image. A real
 * copy is the only thing that ships -- so it is generated here, on every
 * build, rather than committed and kept in step by hand.
 */
import { copyFileSync, lstatSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../icon.svg', import.meta.url))
const target = fileURLToPath(new URL('../public/icon.svg', import.meta.url))

mkdirSync(fileURLToPath(new URL('../public', import.meta.url)), {
  recursive: true,
})

// copyFileSync writes *through* an existing symlink, which would silently
// overwrite the root icon with itself and leave the broken link in place.
if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) {
  rmSync(target)
}

copyFileSync(source, target)
