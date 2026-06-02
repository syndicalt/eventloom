import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const siteHtml = readFileSync(resolve("site/index.html"), "utf8");
const siteCss = readFileSync(resolve("site/style.css"), "utf8");
const pagesWorkflowPath = resolve(".github/workflows/pages.yml");

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
      'data-viz-tab="capture"',
      'data-viz-tab="replay"',
      'data-viz-tab="handoff"',
      'data-viz-pane="capture"',
      'data-viz-pane="replay"',
      'data-viz-pane="handoff"',
    ]) {
      expect(siteHtml).toContain(requiredHook);
    }
  });

  test("uses the refreshed social card metadata", () => {
    expect(siteHtml).toContain(
      'property="og:image" content="https://syndicalt.github.io/eventloom/assets/social-card.png"',
    );
    expect(siteHtml).toContain(
      'name="twitter:image" content="https://syndicalt.github.io/eventloom/assets/social-card.png"',
    );
    expect(siteHtml).toContain(
      'property="og:title" content="Eventloom - runtime trace layer for agent systems"',
    );
    expect(siteHtml).toContain(
      'name="twitter:title" content="Eventloom - runtime trace layer for agent systems"',
    );
    expect(existsSync(resolve("site/assets/social-card.png"))).toBe(true);
  });

  test("uses a dark technical visual system without purple gradients or decorative blob language", () => {
    expect(siteCss).toContain("color-scheme: dark");
    expect(siteCss).toContain("--background: #05070b");
    expect(siteCss).not.toMatch(/purple|violet|orb|bokeh|blob/i);
  });

  test("deploys the static site directory through GitHub Pages workflow publishing", () => {
    expect(existsSync(pagesWorkflowPath)).toBe(true);
    const workflow = readFileSync(pagesWorkflowPath, "utf8");

    expect(workflow).toContain("actions/upload-pages-artifact");
    expect(workflow).toContain("actions/deploy-pages");
    expect(workflow).toContain("path: site");
    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
  });
});
