# Eventloom Site Refactor Design

## Objective

Refactor the Eventloom GitHub Pages site to present Eventloom 1.0 as a stable, local-first runtime trace layer for agent systems. The site should feel related to Tugboat's serious, dense, technical design language without becoming a Tugboat clone. Eventloom keeps its own product identity: append-only traces, deterministic replay, tamper-evident session artifacts, and export bridges for agent observability.

This is a static-site refresh only. It does not change runtime behavior, package APIs, CLI behavior, MCP contracts, release metadata, or Eventloom's core architecture.

## Current Context

The current site lives in `site/` and is implemented as plain HTML and CSS:

- `site/index.html`
- `site/style.css`
- `site/assets/hero.png`
- `site/assets/hero-product.png`

The current page already has the right product ingredients: local-first logs, replay, visualizer, MCP, Pathlight, HALO, OTLP, and installation instructions. The gap is emphasis. The current copy leans on "black box recorder for AI agents" as the primary frame and uses a lighter SaaS-style visual treatment. For the v1.0 release, the site should make Eventloom feel more like durable infrastructure: a trace layer developers can install beside agent workflows and trust during debugging, handoff, replay, and export.

## Approved Direction

Use the "Runtime Trace Layer" direction selected during design review.

The first-viewport message should lead with Eventloom as infrastructure for preserving agent session history, not as a generic AI-agent landing page. The black-box-recorder metaphor can remain as a supporting explanation, but the primary identity is:

> A runtime trace layer for agent systems.

The page should communicate three core product proofs:

- Capture: typed agent runtime events are written to append-only JSONL.
- Replay: projections rebuild state from the event history without rerunning agents.
- Export: traces and handoffs can move into Pathlight, HALO, OTLP artifacts, MCP clients, and human review workflows.

## Content Design

This is a targeted content rewrite, not a full product-doc rewrite. Keep accurate technical claims and existing core concepts, but reduce repeated generic phrasing.

Primary hero content:

- Headline should identify the category: "A runtime trace layer for agent systems" or a close variant.
- Supporting copy should explain Eventloom as a local-first event log that preserves agent work as verifiable runtime artifacts.
- Primary calls to action should remain practical: install/use locally, inspect the visualizer, and visit GitHub/docs.

Recommended page structure:

1. Hero: product identity, concise proof points, and practical CTAs.
2. Proof strip: npm packages, GitHub, docs, and visualizer or release links.
3. Visualizer: keep the interactive proof surface, but frame it as trace inspection rather than a demo widget.
4. Why traces: explain why transcripts alone are insufficient for agent work.
5. How it works: capture, validate, append, replay, export.
6. Agent session artifacts: position the human-to-agent conversation and runtime events as durable repo/workflow artifacts.
7. Integrations: MCP, Pathlight, HALO, OTLP, GitHub Actions artifacts.
8. Install and CLI: local commands with low friction.

Tone:

- Use direct developer language.
- Prefer concrete nouns: event log, projection, trace, replay, handoff, hash chain, artifact.
- Avoid over-selling autonomy or making claims that imply a hosted platform.
- Keep the v1.0 identity stable and trustworthy.

## Visual Design

Borrow Tugboat's density, confidence, and editorial restraint, while using Eventloom-specific trace visuals.

Visual principles:

- Dark technical base with high-contrast text and restrained warm surfaces.
- Event colors should be functional: cyan/teal for capture, green for verified/replayed state, amber for pending/handoff or review, red only for invalid/rejected states.
- Use fine borders, grid lines, monospaced labels, hash-chain fragments, event rows, and trace panels as the visual vocabulary.
- Avoid purple-dominant gradients, decorative blobs, orb backgrounds, and marketing-style card stacks.
- Keep cards only where they represent repeated items or framed tools. Do not nest cards.
- Preserve responsive behavior across mobile and desktop; text must not overlap or spill out of buttons, panels, or cards.

Hero treatment:

- The product should be visible in the first viewport through a trace artifact panel or generated/static bitmap that shows event streams, replay state, and export paths.
- The next section should be hinted below the fold on normal desktop and mobile viewports.
- The hero should not be a split card layout. It should feel like the product interface and the page share one environment.

## Social Card

Update the social media card to match the new design language.

Implementation scope:

- Replace or add a site asset for the Open Graph and X/Twitter card.
- Update `og:title`, `og:description`, `og:image`, `twitter:title`, `twitter:description`, and `twitter:image` in `site/index.html`.
- The image should read clearly at social-card sizes and should not depend on tiny body copy.

Recommended card direction:

- Dark trace-layer composition.
- Large Eventloom wordmark or product name.
- Short category line: "Runtime trace layer for agent systems."
- Visual motif: append-only event rows, hash-chain links, replay/export panels, or a sealed session artifact.

## Implementation Boundaries

In scope:

- Refactor `site/index.html`.
- Refactor `site/style.css`.
- Add or replace static assets under `site/assets/` for the hero/social treatment.
- Update social metadata.
- Preserve existing visualizer functionality unless a bug is discovered during the refactor.
- Keep the static GitHub Pages deployment model.

Out of scope:

- Runtime/library code changes.
- MCP package changes.
- CLI contract changes.
- Event model changes.
- New framework, build system, or deployment pipeline.
- Broad documentation rewrites outside site-facing links and labels.

## Verification Plan

Use local static serving for inspection.

Required checks:

- Serve `site/` locally and inspect desktop and mobile viewports.
- Verify the hero, visualizer, proof strip, integrations, install section, and footer remain readable.
- Check that navigation anchors still resolve.
- Confirm visualizer sample rendering still works after markup/style changes.
- Confirm Open Graph and X/Twitter metadata point to the new social image.
- Run repository tests or at minimum a site-focused smoke check if the implementation does not touch TypeScript runtime files.
- Check `git status` before staging and stage only site/spec-related files, preserving existing unrelated MCP release edits.

## Success Criteria

- The page clearly positions Eventloom as a v1.0-ready runtime trace layer.
- The design feels serious, technical, and differentiated from the previous light landing page.
- Tugboat influence shows through density, restraint, and product-forward composition, not direct copying.
- The content rewrite improves clarity without changing Eventloom's architectural claims.
- The social card matches the refreshed identity.
- The implementation remains static, lightweight, accessible, responsive, and compatible with GitHub Pages.
