# Eventloom Site Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the GitHub Pages site as the approved dark, Tugboat-influenced Eventloom Runtime Trace Layer experience.

**Architecture:** Keep the existing static GitHub Pages structure: one HTML page, one CSS file, and static assets under `site/assets/`. Preserve the inline visualizer script and its required DOM hooks while replacing the page composition, copy, metadata, and social-card asset.

**Tech Stack:** Static HTML/CSS, vanilla browser JavaScript, Node.js smoke tests using built-in `node:test`, repo `npm test`, local static serving for rendered verification.

---

## File Structure

- Modify `site/index.html`: metadata, navigation, hero, sections, visualizer framing, social-card references, and footer.
- Modify `site/style.css`: dark technical visual system, responsive layout, visualizer styling, and social-card helper styling if needed.
- Add `site/assets/social-card.png`: dark Eventloom social card for Open Graph and X/Twitter metadata.
- Add `tests/site-smoke.test.ts`: static tests for required DOM hooks, metadata, social-card path, and core positioning copy.

## Task 1: Add Site Smoke Coverage

**Files:**
- Create: `tests/site-smoke.test.ts`

- [ ] **Step 1: Write the failing/static smoke test**

Create `tests/site-smoke.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const siteHtml = readFileSync(resolve("site/index.html"), "utf8");
const siteCss = readFileSync(resolve("site/style.css"), "utf8");

describe("GitHub Pages site", () => {
  test("positions Eventloom as a runtime trace layer", () => {
    expect(siteHtml).toContain("A runtime trace layer for agent systems");
    expect(siteHtml).toContain("Capture");
    expect(siteHtml).toContain("Replay");
    expect(siteHtml).toContain("Export");
  });

  test("keeps visualizer hooks used by the inline script", () => {
    for (const requiredHook of [
      'id="log-file"',
      'id="load-sample"',
      'id="render-log"',
      'id="log-input"',
      'id="log-status"',
      'id="visualizer-title"',
      'id="viz-capture-events"',
      'id="viz-capture-caption"',
      'id="viz-replay-output"',
      'id="viz-handoff-output"',
      "data-viz-tab=\"capture\"",
      "data-viz-tab=\"replay\"",
      "data-viz-tab=\"handoff\"",
      "data-viz-pane=\"capture\"",
      "data-viz-pane=\"replay\"",
      "data-viz-pane=\"handoff\"",
    ]) {
      expect(siteHtml).toContain(requiredHook);
    }
  });

  test("uses the refreshed social card metadata", () => {
    expect(siteHtml).toContain('property="og:image" content="https://syndicalt.github.io/eventloom/assets/social-card.png"');
    expect(siteHtml).toContain('name="twitter:image" content="https://syndicalt.github.io/eventloom/assets/social-card.png"');
    expect(siteHtml).toContain('property="og:title" content="Eventloom - runtime trace layer for agent systems"');
    expect(siteHtml).toContain('name="twitter:title" content="Eventloom - runtime trace layer for agent systems"');
  });

  test("uses a dark technical visual system without purple gradients or orb decoration", () => {
    expect(siteCss).toContain("color-scheme: dark");
    expect(siteCss).toContain("--background: #05070b");
    expect(siteCss).not.toMatch(/purple|violet|orb|bokeh/i);
  });
});
```

- [ ] **Step 2: Run the site smoke test and verify red**

Run:

```bash
npm test -- tests/site-smoke.test.ts
```

Expected: the new positioning/social-card/dark-theme assertions fail against the current light site.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/site-smoke.test.ts
git commit -m "test: add site rebuild smoke coverage"
```

## Task 2: Rebuild HTML Content and Metadata

**Files:**
- Modify: `site/index.html`

- [ ] **Step 1: Update metadata**

Set the title and social metadata to the v1 positioning:

```html
<title>Eventloom - runtime trace layer for agent systems</title>
<meta name="description" content="Eventloom is a local-first runtime trace layer for agent systems. Capture append-only JSONL events, replay deterministic projections, and export session artifacts to MCP clients, Pathlight, HALO, and OTLP." />
<meta property="og:title" content="Eventloom - runtime trace layer for agent systems" />
<meta property="og:description" content="Capture append-only agent events, replay deterministic state, and export verified session artifacts from a local-first runtime trace layer." />
<meta property="og:image" content="https://syndicalt.github.io/eventloom/assets/social-card.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:title" content="Eventloom - runtime trace layer for agent systems" />
<meta name="twitter:description" content="Local-first trace artifacts for agent debugging, replay, handoff, and observability." />
<meta name="twitter:image" content="https://syndicalt.github.io/eventloom/assets/social-card.png" />
```

- [ ] **Step 2: Replace the hero and section copy**

Use this first-viewport structure while preserving `id="top"`:

```html
<section class="hero" id="top">
  <div class="hero-grid" aria-hidden="true">
    <span></span><span></span><span></span><span></span>
  </div>
  <div class="hero-inner">
    <p class="eyebrow">Eventloom v1.0</p>
    <h1>A runtime trace layer for agent systems.</h1>
    <p class="tagline">
      Preserve the human-to-agent session as a verifiable artifact. Eventloom records
      typed intentions, events, tool calls, model calls, approvals, and handoffs into
      an append-only JSONL log you can replay, inspect, and export.
    </p>
    <div class="signal-row" aria-label="Runtime trace guarantees">
      <span>Append-only JSONL</span>
      <span>SHA-256 hash chain</span>
      <span>Deterministic replay</span>
      <span>MCP + trace exports</span>
    </div>
    <div class="cta-row">
      <a class="btn btn-primary" href="#install">Install locally</a>
      <a class="btn btn-secondary" href="#visualizer">Inspect a trace</a>
      <a class="btn btn-secondary" href="https://github.com/syndicalt/eventloom">GitHub</a>
    </div>
  </div>
  <aside class="trace-console" aria-label="Eventloom trace preview">...</aside>
</section>
```

The `trace-console` content should show event rows, hash fragments, and a replay/export status panel with visible labels: Capture, Replay, Export.

- [ ] **Step 3: Preserve and reframe the visualizer**

Keep all existing visualizer controls and output IDs exactly as tested. Update surrounding copy to frame it as "Trace inspector" and "Paste JSONL, replay state, and generate handoff context."

- [ ] **Step 4: Add the agent session artifact section**

Add a section explaining that the human-to-agent conversation and runtime history are worth preserving in repos or workflow artifacts:

```html
<section class="artifact-section" aria-label="Agent session artifacts">
  <div class="section-heading">
    <p class="eyebrow">Session artifacts</p>
    <h2>The conversation that created the work belongs with the work.</h2>
    <p>Eventloom turns agent sessions into append-only records that can live beside code, CI artifacts, release notes, or handoff bundles.</p>
  </div>
  ...
</section>
```

- [ ] **Step 5: Run the site smoke test**

Run:

```bash
npm test -- tests/site-smoke.test.ts
```

Expected: metadata/content/hook assertions pass; CSS assertions may still fail until Task 3.

## Task 3: Rebuild CSS Visual System

**Files:**
- Modify: `site/style.css`

- [ ] **Step 1: Replace the visual system variables**

Use a dark system with explicit functional accent colors:

```css
:root {
  color-scheme: dark;
  --background: #05070b;
  --surface: #0b111b;
  --surface-raised: #111827;
  --panel: #151c2a;
  --ink: #f7fafc;
  --copy: #c9d3df;
  --muted: #7d8b9f;
  --line: rgba(190, 206, 226, 0.18);
  --line-strong: rgba(190, 206, 226, 0.32);
  --capture: #2dd4bf;
  --replay: #7ddc84;
  --handoff: #f6c453;
  --reject: #ef6461;
  --paper: #f2ead7;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
}
```

- [ ] **Step 2: Implement the hero and trace-console layout**

Desktop: two-column product-forward hero with large left copy and right trace console. Mobile: one-column with console below copy. Use grid lines and borders, not decorative blobs.

- [ ] **Step 3: Restyle sections**

Use full-width bands and constrained inner content. Use cards only for repeated items: proof links, value items, install cards, integration links, and visualizer panels.

- [ ] **Step 4: Preserve visualizer usability**

Keep textarea readable, tab buttons stable, output panels scrollable, and event rows responsive with no text overlap.

- [ ] **Step 5: Run the site smoke test**

Run:

```bash
npm test -- tests/site-smoke.test.ts
```

Expected: all site smoke tests pass.

- [ ] **Step 6: Commit HTML/CSS rebuild**

```bash
git add site/index.html site/style.css tests/site-smoke.test.ts
git commit -m "feat: rebuild Eventloom site"
```

## Task 4: Add Social Card Asset

**Files:**
- Create: `site/assets/social-card.png`

- [ ] **Step 1: Create the social card SVG**

Create a 1200x630 PNG with:

- Dark background `#05070b`.
- Large text `Eventloom`.
- Category line `Runtime trace layer for agent systems`.
- Event rows, hash-chain fragments, and Capture / Replay / Export labels.
- No tiny paragraph text.

- [ ] **Step 2: Verify metadata path**

Run:

```bash
npm test -- tests/site-smoke.test.ts
```

Expected: social-card metadata tests pass and `site/assets/social-card.png` exists.

- [ ] **Step 3: Commit social card**

```bash
git add site/assets/social-card.png site/index.html tests/site-smoke.test.ts
git commit -m "feat: add Eventloom social card"
```

## Task 5: Rendered Verification

**Files:**
- No required edits unless verification finds issues.

- [ ] **Step 1: Serve the site locally**

Run:

```bash
python3 -m http.server 49493 --directory site
```

Expected: site available at `http://localhost:49493/`.

- [ ] **Step 2: Inspect desktop and mobile renderings**

Use browser or screenshot tooling to inspect:

- Desktop 1440x1000.
- Mobile 390x844.
- Social card PNG at `http://localhost:49493/assets/social-card.png`.

Expected:

- Dark first viewport.
- Hero copy visible and not inside a card.
- Trace console visible in first viewport on desktop.
- Next section hinted below hero.
- Mobile nav wraps without overlap.
- Visualizer controls and tabs work.
- No unreadable text, button overflow, or nested cards.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Final status check**

Run:

```bash
git status --short
```

Expected: only intended site rebuild files are modified/staged or committed; unrelated MCP release edits remain untouched unless separately requested.
