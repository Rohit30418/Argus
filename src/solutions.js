function stableId(input) {
  let h = 2166136261;
  for (const ch of String(input || '')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return `iss_${(h >>> 0).toString(36)}`;
}

const RULES = [
  {
    match: /page could not be fetched|server error|http error|returns 5\d\d/i,
    owner: 'Backend / Infrastructure',
    why: 'The browser cannot reliably complete the page or request, so downstream UI behavior may be incomplete or misleading.',
    root: 'The route, upstream service, application process, TLS/DNS path, authentication, or request payload may be failing. The status/request evidence should be checked against server logs.',
    steps: [
      'Reproduce the exact URL/request using the evidence shown by ARGUS.',
      'Check the response status, method, payload, response body and request correlation/request ID when available.',
      'Open application/reverse-proxy logs for the same timestamp and identify the first server-side exception or rejection.',
      'Fix the owning route/service/configuration rather than masking the error in the frontend.',
      'Add a user-visible error/empty state so the UI exits loading state even if the backend fails.',
      'Re-run the same ARGUS journey and verify the request returns the expected 2xx/3xx result.'
    ],
    inspect: ['API/controller/handler for the failing route', 'Reverse proxy / hosting logs', 'Request validation or auth middleware', 'Frontend error state'],
    snippet: `try {\n  const response = await fetch(url, options);\n  if (!response.ok) throw new Error(\`HTTP \${response.status}\`);\n  renderSuccess(await response.json());\n} catch (error) {\n  renderUsefulErrorState(error);\n}`,
    retest: ['Repeat the captured request/journey.', 'Confirm expected status and response payload.', 'Confirm loading indicators stop.', 'Confirm no equivalent console/network error remains.']
  },
  {
    match: /page returns 404|broken link|404/i,
    owner: 'Frontend / Content / Routing',
    why: 'Users and crawlers reach a dead destination; repeated 404s often indicate stale templates, CMS content, or routing rules.',
    root: 'A source link points to a removed/renamed route, or the intended route was never deployed.',
    steps: ['Locate every source page linking to the broken URL.', 'Decide whether the target should exist, move, or be removed.', 'Update the source href or restore the route.', 'Use a redirect only when there is a genuine replacement.', 'Re-scan all pages using the same template to catch repeated stale links.'],
    inspect: ['Navigation/menu data', 'CMS content', 'Route configuration', 'Shared card/list templates'],
    snippet: '<a href="/correct-route">Correct destination</a>',
    retest: ['Open the destination directly.', 'Confirm it no longer returns 404.', 'Re-run link validation on every affected template.']
  },
  {
    match: /missing page title/i,
    owner: 'Frontend / SEO',
    why: 'The browser tab and search result have no reliable page identity; repeated missing titles often come from a shared layout/template.',
    root: 'The document does not expose a non-empty <title>, or the title is populated too late/incorrectly.',
    steps: ['Add a unique title in the server-rendered or final rendered head.', 'Put the page topic first and site name second.', 'Avoid duplicating one title across dynamic detail pages.', 'Check the shared layout if many pages are affected.'],
    inspect: ['Master/layout head', 'Route metadata', 'CMS SEO fields'],
    snippet: '<title>Page topic | Site name</title>',
    retest: ['Reload the page.', 'Confirm document.title is non-empty.', 'Compare titles across sibling pages.', 'Re-run ARGUS SEO checks.']
  },
  {
    match: /meta description/i,
    owner: 'Content / SEO',
    why: 'Search engines may build an uncontrolled snippet and repeated templates become harder to distinguish.',
    root: 'A page-specific description meta tag is absent, empty, or not populated by the shared template.',
    steps: ['Add one non-empty description per indexable page.', 'Keep it specific to that page.', 'Populate it from CMS/detail data for repeated templates.', 'Avoid duplicating a generic site description everywhere.'],
    inspect: ['Shared head/layout', 'CMS SEO fields', 'Dynamic route metadata'],
    snippet: '<meta name="description" content="Concise page-specific description">',
    retest: ['Inspect the rendered <head>.', 'Confirm exactly one non-empty description exists.', 'Check sibling dynamic pages for uniqueness.']
  },
  {
    match: /missing h1|multiple h1/i,
    owner: 'Frontend / Content',
    why: 'Heading structure becomes harder to understand for assistive technology and content hierarchy becomes ambiguous.',
    root: 'The page template lacks a primary heading or repeated components are incorrectly using H1 for visual sizing.',
    steps: ['Identify the page topic and expose it as the primary H1.', 'Demote section/card titles to H2/H3 where appropriate.', 'Fix the shared component if repeated pages inherit the problem.', 'Use CSS classes for visual size instead of semantic heading levels.'],
    inspect: ['Page template', 'Shared hero/title component', 'Reusable card components'],
    snippet: '<h1>Primary page heading</h1>',
    retest: ['Inspect heading order.', 'Verify the page has one clear primary heading.', 'Keyboard/screen-reader spot check the heading list.']
  },
  {
    match: /images missing alt|missing alt|image alt/i,
    owner: 'Frontend / Content',
    why: 'Informative images may be unavailable to screen-reader users; repeated missing alt attributes usually point to a shared card/gallery template.',
    root: 'The image component/template renders src but does not bind an alt value, or decorative images are missing an explicit empty alt.',
    steps: ['Use the evidence selector to open the exact image/component.', 'Decide whether the image is informative or decorative.', 'For informative images, bind concise contextual alt text from the content model.', 'For decorative images, render alt="" so assistive technology can ignore them.', 'If many pages are affected, fix the shared image/card/gallery component once.', 'Re-run the affected template family, not just one page.'],
    inspect: ['Image component', 'Card/gallery template', 'CMS image metadata'],
    snippet: '<img src="..." alt="Describe the useful information conveyed by the image">',
    retest: ['Inspect the captured element again.', 'Confirm every informative image has useful alt text.', 'Confirm decorative images use alt="".', 'Re-run the same template cluster.']
  },
  {
    match: /interactive controls may be unlabeled|unlabeled control/i,
    owner: 'Frontend / Accessibility',
    why: 'An icon-only or otherwise unnamed control may be announced as an ambiguous button/link, making the action difficult or impossible to understand.',
    root: 'The element has no visible text, associated <label>, aria-label, aria-labelledby, or meaningful title.',
    steps: ['Open the exact captured control using the selector/HTML evidence.', 'Prefer visible text when the design allows it.', 'For icon-only controls, provide aria-label or aria-labelledby.', 'For form controls, associate a real <label for="...">.', 'Do not rely on placeholder text as the only accessible name.', 'Re-test keyboard focus and the computed accessibility name.'],
    inspect: ['Icon button component', 'Form field component', 'ARIA attributes'],
    snippet: '<button type="button" aria-label="Open navigation"><svg aria-hidden="true">...</svg></button>',
    retest: ['Tab to the control.', 'Inspect its accessible name.', 'Confirm the label describes the action, not the icon.', 'Re-run ARGUS accessibility checks.']
  },
  {
    match: /duplicate element ids/i,
    owner: 'Frontend',
    why: 'Duplicate IDs can break label associations, fragment navigation, DOM targeting and JavaScript behavior in repeated components.',
    root: 'A repeated component/template uses a hard-coded id instead of generating a unique value.',
    steps: ['Locate every element using the duplicated ID.', 'Move styling hooks to classes/data attributes.', 'Generate unique IDs only where ID semantics are actually required.', 'Update label for/aria-labelledby/aria-describedby references together.', 'Retest repeated rows/cards/modals where the component appears.'],
    inspect: ['Repeated component/template', 'Modal/form IDs', 'Label and ARIA references'],
    snippet: '<input id={`email-${rowId}`} ...>\n<label htmlFor={`email-${rowId}`}>Email</label>',
    retest: ['Confirm document.querySelectorAll("[id]") contains no duplicate values.', 'Verify labels/ARIA still resolve to the intended element.']
  },
  {
    match: /horizontal overflow on mobile/i,
    owner: 'Frontend / Responsive UI',
    why: 'Users can be forced into horizontal scrolling and important controls/content may sit outside the viewport.',
    root: 'A fixed/min width, unbreakable content, oversized media, positioned element, table, or flex/grid child is wider than the mobile viewport.',
    steps: ['Open the cropped ARGUS evidence and inspect the exact selector.', 'Check computed width/min-width/left/right/transform values.', 'Remove unnecessary fixed pixel widths and allow flex/grid children to shrink.', 'Constrain media/iframes/tables to the container or provide intentional horizontal scrolling only where appropriate.', 'Re-test at 320, 360, 375 and 390 px widths.', 'Verify no new clipping was introduced at tablet/desktop breakpoints.'],
    inspect: ['Captured selector and parent layout', 'Grid/flex min-width', 'Tables/media/iframes', 'Absolute/fixed positioning'],
    snippet: `img, video, iframe { max-width: 100%; height: auto; }\n.flex-child { min-width: 0; }\n.table-wrap { overflow-x: auto; }`,
    retest: ['Set viewport to 320px and 390px.', 'Confirm documentElement.scrollWidth <= clientWidth.', 'Check the captured element remains readable and usable.']
  },
  {
    match: /small tap target/i,
    owner: 'Frontend / Responsive UI',
    why: 'Small touch targets increase accidental taps and make mobile navigation harder, especially for users with motor impairments.',
    root: 'The clickable box is smaller than the configured touch heuristic or neighboring targets are too tightly packed.',
    steps: ['Inspect the exact captured control and its clickable bounding box.', 'Increase padding/min size on the clickable element, not only the icon.', 'Preserve sufficient spacing between adjacent controls.', 'Check that increasing size does not cause wrapping/overflow.', 'Retest the same control at mobile widths.'],
    inspect: ['Button/link CSS', 'Icon-only controls', 'Header/mobile navigation'],
    snippet: '.icon-button { min-inline-size: 44px; min-block-size: 44px; display:inline-grid; place-items:center; }',
    retest: ['Measure the element bounding box again.', 'Confirm adjacent controls remain distinct.', 'Repeat ARGUS mobile checks.']
  },
  {
    match: /console errors observed|interaction throws/i,
    owner: 'Frontend / Integration',
    why: 'Unhandled client-side exceptions can stop later event handlers, rendering updates, API calls or state transitions.',
    root: 'Application code or a dependency threw while the page/interaction was running. The first application stack frame is usually more useful than later cascading errors.',
    steps: ['Repeat the captured page/interaction with DevTools open.', 'Start with the first unique console exception, not the last cascade.', 'Identify the first application-owned stack frame or failed dependency.', 'Validate missing/null state and async failure paths.', 'Fix the originating exception instead of suppressing it with a broad empty catch.', 'Repeat the same interaction and confirm both UI state and network behavior complete normally.'],
    inspect: ['First application stack frame', 'Event handler/state transition', 'Failed third-party dependency'],
    snippet: `// Guard the actual nullable/failed dependency.\nif (!data) {\n  renderEmptyState();\n  return;\n}\nrenderFeature(data);`,
    retest: ['Reload with console cleared.', 'Repeat the exact reproduction steps.', 'Confirm no equivalent exception appears.', 'Verify expected DOM/network change occurs.']
  },
  {
    match: /failed network requests observed/i,
    owner: 'Frontend / Backend / Network',
    why: 'A failed resource/API request can leave features incomplete, stale or stuck in loading/error states.',
    root: 'The request may be blocked, cancelled, DNS/TLS failed, offline, CORS-rejected, or its upstream dependency unavailable.',
    steps: ['Inspect the exact request URL, method and browser failure text.', 'Determine whether it is an application API or static/third-party dependency.', 'Check CORS/TLS/DNS/availability as appropriate.', 'Handle the failure visibly in the owning UI.', 'Remove obsolete requests when the dependency is no longer required.'],
    inspect: ['Network request initiator', 'API/CORS configuration', 'Third-party dependency', 'UI loading/error state'],
    snippet: '// Treat network failure as an explicit UI state; do not leave the screen indefinitely loading.',
    retest: ['Repeat the request.', 'Confirm it completes successfully or is intentionally removed.', 'Confirm the owning UI handles failure gracefully.']
  },
  {
    match: /runtime request returns 5xx/i,
    owner: 'Backend / API',
    why: 'A server-side failure was observed during the actual browser runtime and can directly break the owning feature.',
    root: 'The backend endpoint or an upstream dependency failed while the page was active.',
    steps: ['Open the exact failing request in ARGUS Network evidence.', 'Capture request method/payload/headers and response body if available.', 'Correlate the timestamp with backend logs.', 'Fix the first server exception/upstream failure.', 'Add idempotent retry only when the operation is safe and the failure mode warrants it.', 'Re-run the browser journey and confirm the endpoint remains healthy.'],
    inspect: ['API handler/service', 'Database/upstream logs', 'Request validation', 'Frontend error state'],
    snippet: '// Fix server cause first. Frontend should still surface a clear recoverable error state.',
    retest: ['Repeat the owning journey.', 'Confirm no 5xx response.', 'Confirm expected UI result.', 'Re-run ARGUS interaction/network investigation.']
  },
  {
    match: /ui control.*no observable effect|no observable effect/i,
    owner: 'Frontend / QA Review',
    why: 'The tested control did not produce a detectable URL, DOM, visibility or network change; it may be dead, blocked, or a heuristic false positive.',
    root: 'The handler may not be wired, an exception may stop it, the result may be visually subtle, or the control may intentionally have no immediate observable state.',
    steps: ['Use the captured control screenshot and selector to reproduce manually.', 'Check event listeners/handler binding and disabled/overlay state.', 'Inspect console and network evidence created during the click.', 'Confirm the expected visual/URL/state change for this control.', 'If behavior is legitimate but subtle, add a deterministic assertion rule for that component so future ARGUS runs can verify it.'],
    inspect: ['Control event handler', 'Overlay/pointer-events', 'State update', 'Expected DOM region'],
    snippet: '// Add a stable state change (ARIA state, visible panel, URL, request, etc.) that QA can verify deterministically.',
    retest: ['Repeat the captured click.', 'Confirm the expected state changes.', 'Confirm ARGUS classifies the interaction as observable.']
  },
  {
    match: /interaction error|click.*failed/i,
    owner: 'Frontend / QA Review',
    why: 'ARGUS could not complete a safe interaction against the visible control, which may indicate overlay, detached DOM, disabled state, navigation timing, or automation ambiguity.',
    root: 'The target may be covered, replaced during render, disabled, or not uniquely identifiable at click time.',
    steps: ['Open the captured control and DOM selector.', 'Check whether another element overlays it or pointer-events are blocked.', 'Verify the element remains attached and enabled after page hydration.', 'Use a stable role/name/test-id for the control when possible.', 'Repeat the interaction manually before treating the finding as a product bug.'],
    inspect: ['Target locator', 'Overlay/z-index', 'Hydration/re-render timing', 'Disabled state'],
    snippet: '<button type="button" data-testid="stable-action">...</button>',
    retest: ['Repeat the same interaction manually.', 'Re-run ARGUS.', 'Confirm the element can be located and clicked consistently.']
  },
  {
    match: /slow browser load sample|heavy page transfer sample|slow lcp|lcp/i,
    owner: 'Frontend / Performance',
    why: 'Slow navigation or heavy transfer can delay usable content and amplify problems on slower devices/networks.',
    root: 'Large media, render-blocking CSS/JS, duplicate libraries, fonts, third-party scripts, or backend response time may dominate the sampled load.',
    steps: ['Sort ARGUS network evidence by transfer size and timing.', 'Identify the actual largest/critical above-the-fold resources.', 'Resize/compress hero media and use modern formats.', 'Remove duplicate/unused scripts/styles and defer non-critical third parties.', 'Cache immutable static assets and reduce server TTFB if it is dominant.', 'Retest using the same ARGUS mode so ChangeGuard compares like-for-like samples.'],
    inspect: ['Largest resources', 'Hero/LCP candidate', 'Third-party scripts', 'Server TTFB/cache headers'],
    snippet: '<img src="hero.webp" width="1200" height="630" fetchpriority="high" alt="...">',
    retest: ['Run the same scan mode.', 'Compare load/transfer metrics with ChangeGuard.', 'Confirm visual quality and functionality remain correct.']
  },
  {
    match: /mixed-content resource/i,
    owner: 'Frontend / Infrastructure',
    why: 'HTTPS pages requesting HTTP subresources can be blocked or downgraded by the browser and weaken transport security.',
    root: 'A hard-coded or CMS-provided resource URL still uses http://.',
    steps: ['Locate the exact HTTP resource URL and its initiator.', 'Switch it to HTTPS if the origin supports HTTPS.', 'Otherwise self-host/replace/remove the dependency.', 'Search templates/CMS fields for the same host/path.', 'Re-run the page and confirm no mixed-content request occurs.'],
    inspect: ['Resource URL/initiator', 'CMS content', 'Shared template', 'Proxy/CDN configuration'],
    snippet: 'https://example-cdn.test/resource.js',
    retest: ['Reload the HTTPS page.', 'Confirm every subresource uses HTTPS.', 'Confirm the browser console has no mixed-content warnings.']
  },
  {
    match: /csp header missing|content-security-policy/i,
    owner: 'Security / Infrastructure',
    why: 'The browser has no declared resource execution policy to reduce the impact of injected content.',
    root: 'The application/server is not sending a CSP header on the tested HTML response.',
    steps: ['Inventory scripts, styles, frames, fonts, images and connect destinations.', 'Generate a candidate policy with SENTINEL.', 'Deploy Content-Security-Policy-Report-Only first.', 'Exercise real authenticated/public journeys and collect violations.', 'Remove unnecessary origins/unsafe directives where possible.', 'Enforce the stabilized policy and re-run ARGUS.'],
    inspect: ['Web server/reverse proxy headers', 'Third-party dependency inventory', 'Inline scripts/styles'],
    snippet: "Content-Security-Policy-Report-Only: default-src 'self'; ...",
    retest: ['Inspect the final HTML response headers.', 'Exercise critical journeys.', 'Confirm no required resource is blocked.', 'Switch to enforced CSP only after report-only stabilizes.']
  }
];

function priorityFor(severity) {
  return ({ critical: 'P0', high: 'P1', medium: 'P2', low: 'P3' })[severity] || 'P2';
}

function defaultRepro(issue) {
  const steps = [`Open ${issue.url || 'the affected page'}.`];
  if (issue.selector) steps.push(`Locate the element: ${issue.selector}.`);
  steps.push('Repeat the condition described in Evidence.');
  steps.push('Observe the Actual result below.');
  return steps;
}

export function enrichIssue(issue) {
  const rule = RULES.find(r => r.match.test(String(issue.title || ''))) || {
    owner: 'Developer Review',
    why: 'The observed evidence indicates a QA risk that should be reproduced and traced to the smallest owning component, template, API or configuration.',
    root: 'The exact implementation cause is not proven by the current evidence. Treat the explanation as a hypothesis until reproduced.',
    steps: ['Reproduce using the supplied evidence.', 'Inspect the smallest owning component/template/API.', 'Fix the underlying cause rather than the visible symptom.', 'Re-run the same check after the change.'],
    inspect: ['Affected page/component', 'Related network/console evidence'],
    snippet: '',
    retest: ['Repeat the original reproduction steps.', 'Confirm the evidence no longer appears.', 'Check nearby functionality for regressions.']
  };
  const base = {
    ...issue,
    severity: issue.severity || 'medium',
    confidence: issue.confidence || 'Medium',
    status: issue.status || (issue.confidence === 'Low' ? 'heuristic' : 'confirmed-observation'),
    evidence: String(issue.evidence || ''),
    owner: issue.owner || rule.owner,
    priority: issue.priority || priorityFor(issue.severity),
    whyItMatters: issue.whyItMatters || rule.why,
    likelyCause: issue.likelyCause || rule.root,
    solutionSteps: issue.solutionSteps || rule.steps,
    filesToInspect: issue.filesToInspect || rule.inspect,
    fixSnippet: issue.fixSnippet ?? rule.snippet,
    reproductionSteps: issue.reproductionSteps || defaultRepro(issue),
    expected: issue.expected || 'The page/control/request should complete its intended behavior without the reported QA condition.',
    actual: issue.actual || String(issue.evidence || ''),
    retest: issue.retest || rule.retest,
    artifacts: Array.isArray(issue.artifacts) ? issue.artifacts : [],
    evidenceDetails: issue.evidenceDetails || {},
    autoVerify: issue.autoVerify || null
  };
  base.id = issue.id || stableId([base.url, base.title, base.selector, base.evidence].join('|'));
  return base;
}

export function issueFingerprint(issue) {
  return [issue.category, issue.title, issue.url || issue.page || '', issue.selector || ''].join('|').toLowerCase().replace(/\s+/g, ' ');
}
