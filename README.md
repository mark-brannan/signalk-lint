# signalk-lint

A linter for Signal K server installations — flags misconfigurations, known
vulnerabilities, and quietly broken setups.

Install from the Signal K app store.

Runs hourly in the background; its webapp entry shows the last run's
results, not a fresh one on load. Scheduling is still in flux and will
change as more rules are added.

## Rules

See [`src/rules/`](src/rules/), or run `signalk-lint --list-rules`.

## License

Apache-2.0
