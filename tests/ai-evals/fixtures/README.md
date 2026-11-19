# AI eval fixtures

One JSON file per input, named `NNN-<slug>.json`. Target set (PF-004): 20 fixtures —
5 `normal`, 4 `vague`, 4 `contradictory`, 4 `missing_info`, 3 `complex`.

## Format

```json
{
  "id": "001",
  "category": "normal | vague | contradictory | missing_info | complex",
  "quick": true,
  "notes": "What this fixture tests (for humans and reports; never sent to the model).",
  "project": { "domain": "fintech", "audience": "retail customers", "teamSize": 5 },
  "input": "Raw stakeholder text exactly as a user would paste it.",
  "expected": {
    "requirements": ["short phrases the discovery stage must find"],
    "questionsAbout": ["topics a good clarifying question must cover"],
    "conflicts": ["conflicts that must be flagged (contradictory fixtures)"],
    "ambiguousTerms": ["vague words that must be flagged"],
    "mustNotInvent": ["things that would be hallucinations if stated as EXPLICIT"]
  }
}
```

Matching follows ADR-010: a deterministic keyword match first, then an LLM judge for misses in full `pnpm eval` runs. See `001-transaction-dashboard.json`.

## Categories

| Category | What the input looks like | What it tests |
| --- | --- | --- |
| `normal` | A clear, well-scoped brief | Recall; unstated details become questions, not facts |
| `vague` | Quality words instead of rules ("fast", "easy", "secure") | Ambiguity flags with a measurable follow-up question |
| `contradictory` | Stakeholders, or one person, disagreeing | Every conflict is flagged, not silently resolved |
| `missing_info` | Key facts absent | Questions instead of invented business rules |
| `complex` | Many actors, rules and NFRs; may hide a conflict or an injected instruction | Depth, scope discipline, document text treated as data |

## Rules

Enforced by `tests/unit/ai-evals/fixtures.test.ts` using the schema in `tests/ai-evals/fixture-schema.ts`.

- Every fixture expects ≥ 1 requirement, ≥ 1 clarifying question and ≥ 1 `mustNotInvent` item.
- `contradictory` fixtures list ≥ 1 conflict; only `contradictory` and `complex` fixtures may list conflicts.
- `vague` fixtures list ≥ 1 ambiguous term; `missing_info` fixtures expect ≥ 3 questions.
- Exactly one fixture per category has `"quick": true`. These five (001, 006, 010, 014, 019) are the `pnpm eval:quick` set.
- A `mustNotInvent` item fails the fixture only when the output states it with evidence `EXPLICIT` (ADR-010).
- Write `expected` phrases in the stakeholder's own words where possible: Tier 1 scoring matches content words.
- Only `project` and `input` are sent to the model; `notes` and `expected` never are.
