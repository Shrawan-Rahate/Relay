# Relay frontend

A local, demo-only design foundation built with React, Vite, TypeScript, and Tailwind CSS. No API calls or authentication are implemented.

```sh
cd client
npm ci
npm run dev
npm run typecheck
npm run build
```

## Structure

- `src/styles.css`: semantic color/font tokens, component styles, responsive shell and layouts, focus states, reduced-motion support. Tokens are also exposed through Tailwind's theme.
- `src/components/ui.tsx`: buttons, status badges, source icons, section headings, links, and native accessible modal dialogs.
- `src/pages/Dashboard.tsx`: one next action, three fixture-derived counts, and a four-step handover guide with expandable demo sources.
- `src/pages/KnowledgeGaps.tsx`: status/category filters, search, selectable gap list, selected question, expandable exact source quotes, source inspection, and a clear next action.
- `src/data/demo.ts`: explicitly labelled fixtures. Project and gap shapes use types imported from `shared/api-types.ts`; extra presentation fields are demo-only.

## Demo behavior

Navigation uses `#overview` and `#gaps`, including browser back/forward. Global search opens with Command/Ctrl+K. Source dialogs preserve original fixture text. Status and category filters combine with search; empty states offer a reset. Mobile navigation opens in a keyboard-trapped drawer with Escape support and focus restoration. On smaller screens, a scrollable question list sits above the selected question; selecting a question focuses its details. All controls work locally and no review or publication is simulated as a server action.

There are four source fixtures, five open demo questions, and nine exact evidence references. Summary counts derive from those fixtures. No people, member identities, approvals, extraction runs, or production outcomes are fabricated. Resolved filtering remains available with an empty state until real data is connected. Body text is 16px, metadata is at least 14px, and page titles are 28–32px.

## API integration handoff

Read `../API_INTEGRATION.md` before wiring services. Replace fixture data at the page boundary, preserve `UNVERIFIED` claim semantics, and fetch source/document evidence using the contract URLs with credentials. Fixture IDs are intentionally prefixed `demo-`, not valid API UUIDs. Do not send them to live endpoints. Source display metadata and evidence arrays are view models, not additional API fields. Do not infer totals from paginated API responses or treat approved answers as automatically resolved gaps.

## Design references

Original Relay identity: warm off-white, graphite text, muted evergreen, compact navigation, evidence-first layouts, no charts or invented metrics. Hierarchy and navigation references: [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), [Vercel](https://vercel.com/changelog/dashboard-navigation-redesign-rollout), and composable component principles from [shadcn/ui](https://ui.shadcn.com). The supplied Notion wiki URL returned 404 during research.

The named UI/UX skills were not available in the enabled skill catalog. Available brainstorming, Sites design/accessibility guidance, and verification guidance were consulted. No skills were enabled or changed.
