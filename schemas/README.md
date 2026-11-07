# OIOL Plan Schema Contract

## Current contract

- Schema file: `plan.schema.json`
- JSON Schema dialect identifier: Draft 2020-12
- `schemaVersion`: `1.0.0`
- `contractVersion`: `1.0`
- Schema identifier: `urn:oiol:schemas:plan:1.0.0`

Every generated plan must carry both version fields. The published schema pins them with `const`; consumers must not silently interpret an unknown schema version as the current contract.

## Built-in validator support

OIOL's built-in validator is deliberately a documented subset, not a general-purpose Draft 2020-12 implementation. The supported keywords are:

| Keyword | Implemented behavior | Limitations |
|---|---|---|
| `$schema`, `$id`, `title`, `description` | Schema metadata accepted | Metadata is not used to select a dialect or fetch remote schemas |
| `$defs` | Named nested schema definitions | Local schema nodes only |
| `$ref` | Resolves local JSON Pointer references beginning with `#/` | No remote references, anchors, or dynamic references |
| `type` | Checks null, object, array, string, boolean, integer, and finite number; arrays of types mean any listed type | No custom types |
| `required` | Checks required object property names | No dependent-required semantics |
| `properties` | Validates declared object properties | No pattern properties or property-name schemas |
| `items` | Applies one schema object to every array item | Tuple-style array schemas are unsupported |
| `additionalProperties` | Accepts true/false or validates remaining properties against a schema object | No unevaluated-properties semantics |
| `const`, `enum` | Deep JSON-value equality | No coercion |
| `minLength` | Minimum Unicode code-point count for strings | No max length or regular-expression pattern |
| `minItems` | Minimum array length | No max items |
| `uniqueItems` | Deep JSON-value uniqueness | No custom equality |
| `oneOf`, `anyOf`, `not` | Exactly one, at least one, or zero matching child schemas | Only the listed subset is evaluated recursively |

Any other keyword is rejected during schema inspection. In particular, keywords such as `format`, `pattern`, `minimum`, `maximum`, `contains`, `propertyNames`, `if/then/else`, and `unevaluatedProperties` are not supported by the built-in validator. External consumers should validate against the published schema with a standards-compliant Draft 2020-12 implementation.

## Versioning and migration policy

1. **Patch version** (`1.0.x`): documentation corrections or validator bug fixes that do not intentionally change the contract's accepted data model or field meaning. Publish the change log and regression fixtures.
2. **Minor version** (`1.x.0`): backward-compatible additions such as optional fields or new optional metadata. Existing 1.0 consumers must be able to ignore the new fields. Update `schemaVersion`, `$id`, `SCHEMA_VERSION`, examples, and contract tests together.
3. **Major version** (`2.0.0`): a breaking shape or semantic change, removal/renaming of a field, a newly required field, or a changed interpretation. Bump `schemaVersion` and `contractVersion`; publish a version-specific schema and a documented migration guide. Do not silently reinterpret older plan files.
4. Keep released versioned schemas immutable. `plan.schema.json` is the current convenience pointer; the `plan-1.0.0.schema.json` file is the frozen copy of the currently published contract. For future schema versions, add `plan-<schemaVersion>.schema.json` and never overwrite older snapshots.
5. A validator must fail closed on an unsupported `schemaVersion`. A migration must be an explicit, separately tested conversion that states which source versions it accepts and which information may be lost.
6. A software release version (for example OIOL `0.5.0`) is independent of the plan `schemaVersion`. Do not bump the schema version for implementation-only releases.

## Contract change checklist

- Update `schemaVersion`, `contractVersion`, and `$id` consistently.
- Update `src/contracts/types.mjs`, the published schema, examples, and schema keyword documentation.
- Add valid and invalid contract fixtures, including older-version rejection tests.
- Verify generated plans, CLI validation, Markdown rendering, and benchmark scoring.
- Record migration behavior and compatibility notes in the release notes.
