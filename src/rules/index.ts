/**
 * The rule registry.
 *
 * Adding a rule means adding a file here and an entry below. Each rule is a
 * pure function over a Snapshot with fixtures in test/fixtures -- which is
 * deliberately the smallest possible unit of contribution, because rules are
 * where community knowledge about boats will come from, not from us.
 */
import { Rule } from '../types.js'
import { serverVersionAdvisories } from './server-version-advisories.js'
import { allowReadonlyNonLoopback } from './allow-readonly-non-loopback.js'

export const rules: readonly Rule[] = [
  serverVersionAdvisories,
  allowReadonlyNonLoopback
]

export { serverVersionAdvisories, allowReadonlyNonLoopback }
