# Impact eval — 2026-11-19 (quick set)

Provider: **demo** · model: `demo-engine-v1`. Input: each fixture's demo backlog; three changes to the first covered requirement.

- **Valid and passing the rules: 12/12** (only listed items, every story and the PRD explained, no duplicates; fixtures with nothing covered are skipped).
- **Criteria quoting a changed number rated "must change": 100 %** (2/2; gate ≥ 90 %).
- **Stories that exist only for a withdrawn requirement rated "must change": 100 %** (2/2; gate 100 %).
- False alarms when a qualifier is only added: 0 criteria rated "must change" (target 0).

| Fixture | Requirement | Valid | Number recall | Withdraw | False alarms | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | FR-01 | 3/3 | – | 1/1 | 0 | – |
| 006 | NFR-01 | 3/3 | – | 1/1 | 0 | – |
| 010 | FR-01 | 3/3 | 1/1 | – | 0 | – |
| 014 | – | 0/3 | – | – | 0 | no covered requirement |
| 019 | FR-05 | 3/3 | 1/1 | – | 0 | – |
