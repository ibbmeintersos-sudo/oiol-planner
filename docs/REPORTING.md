# Review reports

OIOL can render an existing engineering plan as a standalone review artifact without calling a model provider. This is a local, deterministic transformation: the command reads a plan JSON file, validates it, and writes HTML, Markdown, or JSON.

## Usage

    oiol report plan.json --out plan.html
    oiol report plan.json --format md --out plan-review.md
    oiol report plan.json --format json

Options:

| Option | Description |
|---|---|
| --format html\|md\|json | Output format. Defaults to html, or is inferred from the --out extension. |
| --out PATH | Write to a file instead of stdout. Parent directories are created. |
| --title TEXT | Override the HTML document title. |

## HTML report

The HTML format is a single self-contained file:

- inline CSS only; no JavaScript or external assets;
- print-friendly layout with page-break protection for panels;
- a Content-Security-Policy meta tag that denies scripts, forms, and external resources;
- every plan value escaped for HTML text and attribute contexts.

Sections include the executive summary, deterministic validation findings, non-blocking quality signals, requirements, architecture, task breakdown and task detail, suggested planning waves, handoff interfaces, requirement traceability, risks, assumptions, unknowns, open questions, and evidence.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | The plan is valid and the report was produced. |
| 2 | The plan is invalid; the report is still produced so findings can be reviewed. |
| 1 | The input could not be read or parsed, or an output path failed. |

## Boundary

The report command does not scan a repository, call a provider, execute target-project tasks, or modify the target repository. It only transforms and validates a plan document that already exists.

## Limitations

- The HTML report is static and has no interactive controls.
- Large plans produce large standalone files because all CSS is inline.
- The report reflects the supplied plan and deterministic checks. It is not an independent human review and is not evidence that implementation occurred.
