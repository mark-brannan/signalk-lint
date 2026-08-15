/**
 * Rule: host/journald-no-max-use
 *
 * A persistent journal with no explicit SystemMaxUse runs on journald's
 * built-in default: up to 10% of the filesystem, capped at 4G
 * (journald.conf(5)). On a server that is fine; on a boat Pi's SD card it
 * is a slow leak with a fuse measured in months -- the boat this rule
 * comes from watched gigabytes of journal crowd an SD card until the
 * server's own database had no room to grow. Nothing was misconfigured in
 * journald's terms; the default was simply sized for a different machine.
 *
 * The conjunction is what keeps this honest: it fires only when the
 * journal is actually persistent (/var/log/journal exists and Storage is
 * not volatile/none) *and* no explicit SystemMaxUse is set anywhere in
 * journald.conf or conf.d. Volatile journals live in tmpfs and die at
 * reboot -- no SD card at risk. An explicit SystemMaxUse of any size is a
 * decision someone made, and second-guessing its number is not this rule's
 * business.
 *
 * Provenance: opinion. The 10%/4G default is documented and deliberate;
 * the judgement that it is wrong for an SD-card boat computer is ours.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'
import { journaldOf } from './host-facts.js'

export const journaldNoMaxUse: Rule = {
  id: 'host/journald-no-max-use',
  description:
    'The journal is persistent with no explicit size cap, and the default can crowd an SD card',
  defaultSeverity: 'warn',
  provenance: 'opinion',
  hostFacts: ['journald'],

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const journald = journaldOf(snapshot)
    if (journald === null) return []

    if (journald.systemMaxUse !== null) return []
    if (!journald.persistentJournalDir) return []
    // An explicit volatile/none Storage= keeps the journal off disk even
    // with the directory present, and tmpfs cannot crowd an SD card.
    if (journald.storage === 'volatile' || journald.storage === 'none') {
      return []
    }

    return [
      {
        title: 'The journal is persistent with no explicit size cap',
        detail:
          '/var/log/journal exists, so the journal is persistent, and no ' +
          'SystemMaxUse is set in ' +
          (journald.files.length > 0
            ? journald.files.join(', ')
            : 'journald.conf or journald.conf.d') +
          '. journald then defaults to using up to 10% of the filesystem, ' +
          'capped at 4G -- sized for a server, not an SD card. On a boat ' +
          'computer that is gigabytes of logs slowly crowding the card the ' +
          'server also lives on, and the failure arrives months later as ' +
          '"no space left on device" during something unrelated.',
        evidence: [
          {
            path: 'host.journald',
            value: {
              persistentJournalDir: journald.persistentJournalDir,
              storage: journald.storage,
              systemMaxUse: null
            }
          }
        ],
        remediation: {
          kind: 'manual',
          description:
            'Set an explicit cap: add SystemMaxUse=200M (or what this ' +
            "card's size warrants) under [Journal] in " +
            '/etc/systemd/journald.conf or a conf.d drop-in, then run ' +
            'systemctl restart systemd-journald. journalctl ' +
            '--disk-usage shows what the journal holds today.'
        },
        references: [
          'https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html#SystemMaxUse='
        ]
      }
    ]
  }
}
