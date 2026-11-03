# LIVE AI Intelligence and Knowledge Gaps

The existing LiveApp renders separate LIVE workflow components; DEMO pages and fixtures are unchanged. Every operation uses the existing RelayApi and selected backend Project. REVIEWER/OUTGOING can extract and scan. INCOMING retains read-only gaps; the existing AI Intelligence navigation restriction is unchanged. Backend authorization remains authoritative.

AI Intelligence lists sources, loads a source's real documents on demand, and permits a selection of 1–20 documents totaling at most 100,000 UTF-8 bytes. Extraction sends only documentIds. The synchronous extraction and scan calls use a 45-second client deadline to allow the backend's 30-second operation limit. A valid SUCCEEDED run alone produces a success message; an empty claims array is a valid empty result. Stored claims have independent cursor pagination. Provider/model/version and provenance come from the backend, and all claims remain UNVERIFIED.

Evidence quotes preserve whitespace and UTF-16 offsets. The source-document button uses the same credentialed transport and a validated same-project API path. A changed current document does not overwrite the stored extraction quote. Gap details display frozen claim-link evidence/provenance returned by GET gap detail. No unsupported single-claim endpoint, approval, gap-status mutation, or synthetic source URL is used.

Gap lists use status/category filters and cursor pagination; filter changes reset the cursor and detail. Scans use POST gaps/scan with an empty object and refresh the list only after a validated successful response. Displayed scan counts are exactly the backend counts; page lengths are not project totals.

All 401/403/404 workflow errors hide the workflow subtree, discard its pending results and expose Refresh project access. RelayApi continues to invalidate auth on 401. Successful backend membership revalidation allows a clean retry. Identity/project/role changes discard old state; ordinary focus checks retain pending selections while the workspace is hidden. Failed requests never become empty results or success. Mutations are never retried automatically; transport timeouts disclose unknown server outcomes and advise refreshing stored results first.

Automated tests use mocked HTTP responses through the real RelayApi. Live end-to-end validation requires a running Supabase-authenticated Express backend, real project memberships and imported documents, plus valid backend Gemini configuration and network access to the provider. No live AI run or provider billing was triggered during implementation. No server/shared changes, migrations, new dependencies, commits or pushes.

## LIVE Clarifications

Clarifications lists OPEN gaps with cursor pagination and reads selected gap detail with frozen linked evidence. OUTGOING alone can POST a new answer; REVIEWER can read the paginated answer list. LIVE reviewer navigation is enabled separately from DEMO. INCOMING is blocked before requests, and backend authorization remains authoritative.

Answer text and optional evidence follow backend limits: nonblank text up to 10,000 characters, at most 10 distinct document/quote pairs, nonblank quotes up to 4,000 characters, no prohibited control characters. The evidence picker loads real same-project source documents and requires exact substring matches without trimming quotes. The server revalidates evidence and membership. No assignment, update, deletion, approval or gap-status endpoint is called.

Success requires a scoped backend answer matching the submission and PENDING_REVIEW effective status; answer history is then fetched again. History renders effectiveReviewStatus and effectiveText rather than treating stored status as approval. A refresh failure is distinct from a confirmed successful submission. Conflicts retain the draft and require question/history refresh. Network/timeouts or malformed responses disclose uncertainty; POSTs are never automatically retried. Pending submissions disable form and question navigation, while project/role changes discard stale results. No persistent client draft or answer cache is created.

Live clarification smoke testing still requires an authenticated Express backend with OUTGOING/REVIEWER/INCOMING test memberships, an open gap and real source documents. The regression suite simulates HTTP through RelayApi; no live answer was submitted during implementation.
