# P12 independent reviewer packet

This packet defines a single reviewer's submission format. It is separate from the final benchmark case so two reviewers can work independently without seeing each other's labels.

## Files

- review.schema.json: JSON Schema 2020-12 for one independent review.
- review-template.json: blank structural template; false attestations and placeholders must be replaced before submission.
- ANNOTATION_GUIDE.md: semantic definitions, evidence protocol, adjudication and prohibited shortcuts.
- annotation-worklist.json: case identity, pinned commits, request, and snapshot artifact references.

## Assignment protocol

1. A coordinator assigns two distinct pseudonymous reviewer IDs to each case and checks conflicts of interest.
2. Give each reviewer the same pinned base snapshot and case request. Keep the other review and all OIOL output hidden.
3. Each reviewer copies the template to reviews/<case-id>/<reviewer-id>.json.
4. Reviewer completes all dimensions. Use unsupported or partial coverage when evidence is incomplete; do not disguise uncertainty as an empty set.
5. Every non-trivial inclusion or exclusion needs an evidence note. Paths refer to the pinned base snapshot; immutable URLs identify a commit, not a moving branch.
6. Freeze both files before revealing either review or running OIOL against the case.
7. A separate adjudicator compares the frozen records and writes final groundTruth plus adjudication rationale into the case file.

## Submission constraints

- Never put reviewer names, emails, or employer details in files.
- reviewerId must be a stable pseudonym and distinct across the two reviewers.
- independence.attested and blinded must be true only when factually accurate.
- conflictOfInterest must be false; a conflicted reviewer is replaced, not waived.
- Do not copy historicalChangedPaths from intake into directFiles or affectedFiles.
- Do not run scripts, tests, builds, package managers, migrations, or application code from target snapshots.
- A completed review is not itself an accepted gold label. Both reviews and adjudication must pass the corpus validator before a case enters manifest.json.

No reviewer submissions are included in this commit. The 36-case worklist remains unassigned and ground truth remains empty.
## Validate a reviewer submission

After saving one completed review JSON file, validate it against the pinned worklist:

    npm run benchmark:real-world:review -- --review reviews/<case-id>/<reviewer-id>.json

When both independent submissions are available, pass the other file as well to enforce distinct reviewer IDs:

    npm run benchmark:real-world:review -- --review reviews/<case-id>/reviewer-a.json --other-review reviews/<case-id>/reviewer-b.json

The validator checks the case identity, pseudonymous reviewer ID, independence and blinding attestations, all ground-truth dimensions, safe relative paths, and evidence notes. It does not decide whether a human's semantic judgment is correct; that remains the purpose of adjudication.
