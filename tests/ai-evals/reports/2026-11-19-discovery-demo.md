# Discovery eval — 2026-11-19

Provider: **demo** · model: `demo-engine-v1` · scoring: ADR-010 Tier 1 (content-word match; no LLM judge yet).

## Summary

| Metric | Result | Gate |
| --- | --- | --- |
| Schema-valid output | 100 % | ≥ 95 % (blocking) |
| Every fixture asks ≥ 1 question | yes | required (blocking) |
| Expected requirements found | 45 % | reported |
| Expected question topics covered | 11 % | reported |
| Expected conflicts flagged | 38 % | reported |
| Expected vague terms flagged | 100 % | reported |
| Fixtures with a mustNotInvent stated as EXPLICIT | 0 | 0 |

**Blocking gates: PASS.** Tier 1 is strict: paraphrases count as misses until the Tier 2 judge lands (PF-028 follow-up).

## Per fixture

| Fixture | Category | Valid | Questions | Requirements | Question topics | Conflicts | Vague terms | Inventions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 001 | normal | ✓ | 11 | 2/4 | 3/5 | – | – | none |
| 002 | normal | ✓ | 4 | 6/7 | 1/5 | – | – | none |
| 003 | normal | ✓ | 4 | 2/8 | 0/5 | – | – | none |
| 004 | normal | ✓ | 5 | 3/9 | 1/5 | – | – | none |
| 005 | normal | ✓ | 5 | 4/7 | 0/5 | – | – | none |
| 006 | vague | ✓ | 8 | 1/3 | 0/6 | – | 8/8 | none |
| 007 | vague | ✓ | 11 | 0/4 | 2/7 | – | 8/8 | none |
| 008 | vague | ✓ | 12 | 0/4 | 1/5 | – | 6/6 | none |
| 009 | vague | ✓ | 10 | 0/3 | 0/5 | – | 8/8 | none |
| 010 | contradictory | ✓ | 5 | 3/5 | 1/4 | 2/3 | – | none |
| 011 | contradictory | ✓ | 6 | 4/5 | 0/4 | 1/3 | – | none |
| 012 | contradictory | ✓ | 7 | 2/5 | 0/4 | 1/3 | – | none |
| 013 | contradictory | ✓ | 5 | 2/6 | 2/4 | 1/3 | – | none |
| 014 | missing_info | ✓ | 7 | 0/1 | 0/6 | – | – | none |
| 015 | missing_info | ✓ | 4 | 1/3 | 0/6 | – | – | none |
| 016 | missing_info | ✓ | 2 | 1/3 | 0/6 | – | 1/1 | none |
| 017 | missing_info | ✓ | 7 | 1/3 | 0/6 | – | – | none |
| 018 | complex | ✓ | 9 | 10/15 | 1/6 | 0/1 | 2/2 | none |
| 019 | complex | ✓ | 6 | 5/13 | 0/5 | – | – | none |
| 020 | complex | ✓ | 3 | 10/18 | 0/6 | – | – | none |

## Missed requirements (Tier 1)

- 001: view transaction history; notify on failed transactions
- 002: flag late cancellations
- 003: look up order by order number and email; select items to return; choose return reason from a list; 30-day return window; refund confirmation email; support view of return status
- 004: submit leave request; annual, sick and unpaid leave types; notify manager; show leave balance before submitting; block annual leave above balance; exclude public holidays per country
- 005: live map tracking of the driver; mark failed delivery with reason; customer picks a new slot after failed delivery
- 006: CRM for sales teams; integrate with other tools
- 007: learning app for students; gamified learning; personalised learning; teacher view of student progress
- 008: leadership dashboard; show key KPIs; mobile friendly; replace monthly finance spreadsheet
- 009: marketplace connecting freelancers and small businesses; payments between businesses and freelancers; matching freelancers to businesses
- 010: minimum age for account holders; retain KYC records
- 011: app size under 20 MB
- 012: paid plans with an upgrade path; annual plan discount; refund policy
- 013: online payment; 5 km delivery radius; ordering hours; delivery by restaurant staff
- 014: booking system
- 015: mobile app syncs with existing system; alerts when data changes
- 016: reports go out on schedule; replace manual reports
- 017: loyalty program in the app; redeem rewards
- 018: upload photos and video of damage; classify simple claims under ₹50,000; claim status notifications at each stage; audit trail of every decision; documents encrypted at rest
- 019: supplier self-registration; finance verifies bank details separately; certificate expiry reminder 30 days before; tax ID formats for EU, UK and India; create vendor master records in SAP S/4HANA; re-verify bank details on change; email supplier contact when bank details change; monthly report of suppliers by status
- 020: online residential building permit application; validate site address against address register; upload drawings as PDF; fee calculated from project value; online card payment; fee waiver for charities approved by an officer; send back incomplete applications and stop the clock; applicant sees application status
