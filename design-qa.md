# 学枢桌面侧栏 Design QA

## Evidence

- Source visual truth:
  - `/mnt/c/Users/Lenovo/Desktop/1.png`
  - `/mnt/c/Users/Lenovo/Desktop/2.png`
  - `/mnt/c/Users/Lenovo/Desktop/3.png`
  - Figma audit board: `https://www.figma.com/design/JPjIgJ4EbD0P3G8UZ96RSW`
- Implementation URL: `http://172.24.20.109:3000/desktop/`
- Final implementation screenshot: `/mnt/d/816/design-audit/sidebar-reference-gap/17-implementation-no-rings.png`
- Focused final rail: `/mnt/d/816/design-audit/sidebar-reference-gap/18-implementation-no-rings-rail.png`
- Final comparison sheet: `/mnt/d/816/design-audit/sidebar-reference-gap/19-reference-vs-no-rings.png`
- Target viewport: `1487 x 1058` CSS pixels, device scale factor `1`
- Source pixels: `1487 x 1058`, `1487 x 1058`, and `1485 x 1059`
- Implementation pixels: `1487 x 1058`
- State: signed-in desktop home, expanded rail, active `首页` tab. QA content differs from the reference account, so the visual judgment is scoped to the shared desktop shell and sidebar.

## Full-view Comparison Evidence

The source home screenshot and the final implementation were placed in one comparison sheet at matched density. After the final user-directed simplification, the shell preserves the dark leather frame, ivory page, narrow left rail, protruding active tab, and raised plaque while intentionally omitting all binding rings. No unintended gap or broken seam remains in the requested sidebar region.

## Focused Region Comparison Evidence

The final rail crop covers the left `280 px`, including the plaque, active page tab, clean page seam, and bottom mountain engraving. Measured browser geometry:

- Rail: `x=10, y=10, w=178, h=1038`
- Plaque: `x=35, y=68, w=112, h=86`
- Active tab: `x=16, y=185, w=154, h=90`
- Rendered binding-ring count: `0`

## Required Fidelity Surfaces

- Fonts and typography: the existing Chinese display-font stack and all navigation labels are preserved.
- Spacing and layout rhythm: the plaque, active tab, and navigation gaps retain the tuned reference proportions after the rings are removed.
- Colors and visual tokens: the implementation uses the established dark leather, aged brass, ivory paper, cinnabar, and ink tokens; no new unrelated palette was introduced.
- Image quality and asset fidelity: the final plaque is a transparent raster asset rendered at its intended slot size without visible alpha halos or stretching.
- Copy and content: navigation copy, routes, and active-state semantics are unchanged.

## Comparison History

- Iteration 1 — `05`, `06`, `08`: the ring read as a thick U-shaped handle, the active tab collided with the hardware, the navigation rhythm was too compact, and the plaque was too square. These were P2 mismatches.
- Iteration 2 — `09`, `10`, `11`: ring scale and navigation cadence were corrected. The plaque remained too wide and flat compared with the roughly 4:3 source crop, so a second asset pass was required.
- Iteration 3 — `13`, `14`, `15`: the plaque was rebuilt from the exact source crop and the compact ring treatment was compared again.
- Iteration 4 — `17`, `18`, `19`: all copper binding rings were removed at the user's direction. The component, both style definitions, asset references, generated `book-ring-v4.png`, and the two unused legacy ring assets were removed; the final browser capture confirms `ringCount=0` and a clean rail/page seam.

## Primary Interactions Tested

- The signed-in desktop route loads successfully at the target viewport.
- Authentication gating and active-route rendering remain intact.
- Browser console errors in the final capture: none.
- Production build completes successfully.
- Targeted desktop-shell and identity tests: `14` passed.
- Full frontend suite: `379` passed, `1` delivery-only test skipped.

## Final Assets

- `frontend/public/brand/desktop/xueshu-plaque-v3.png`

final result: passed
---

# 资源中心闭书页视觉回归（2026-08-19 下午）

## Evidence

- Source visual truth: `/mnt/c/Users/Lenovo/.codex/generated_images/01a005ca-59d6-7b70-b92f-f33c95a9be2b/exec-9ef1d613-7bfb-45ab-ad12-187bf826c167.png`.
- User's pre-fix Chrome capture: `/mnt/c/Users/Lenovo/Desktop/屏幕截图 2026-08-19 145218.png`.
- Full comparison: `/home/furia/projects/816/design-audit/resource-closed-entry-fidelity/01-target-vs-user-before-full.jpg`.
- Focused comparison: `/home/furia/projects/816/design-audit/resource-closed-entry-fidelity/02-target-vs-user-before-focus.jpg`.
- Source pixels: `1616 x 969`; user capture pixels: `1721 x 1215`.
- CSS viewport and device density for the user capture are not exposed by the attached PNG, so the focused comparison is normalized by region width and records the differing aspect ratios instead of asserting pixel-perfect measurements.
- State: signed-in resource center, populated library, closed-book state.
- Implementation URL: `http://127.0.0.1:3000/desktop/resources/`.
- Post-fix implementation screenshot: unavailable because the exact Chrome connection is rejected before browser binding when the Codex workspace URI resolves to `/mnt/d/816`.

## Findings And Fixes

- [P1] Entry imagery and material language did not match the selected target.
  - Evidence: the focused comparison shows low-opacity photographic fills and a large empty color block, while the target uses full-height muted-gold engraving on aged cinnabar and pine surfaces.
  - Fix: generated and installed two dedicated project rasters: `resource-entry-ai-engraving-v1.webp` and `resource-entry-kb-engraving-v1.webp`; both now render edge-to-edge at full opacity.
- [P1] Workbench typography hierarchy was inverted.
  - Evidence: the implementation used a tiny red `资源工作台` eyebrow and made the explanatory sentence the largest heading; the target makes `资源工作台` the display heading and keeps the instruction subordinate.
  - Fix: restored the target hierarchy, centered entry copy, and removed the small generic circular icons that competed with the generated illustrations.
- [P1] The closed-cover title was outside the physical label plate.
  - Evidence: `资源典藏` sat visibly above the blank brass-and-paper plate in the user capture.
  - Fix: moved the editable label from `26.5%` to `34.9%` of the cover height and increased its display weight so it occupies the physical plate.
- [P2] The left workbench lacked the framed-bookplate container and had the wrong horizontal rhythm.
  - Evidence: the user capture begins the cards almost flush with the frame; the target uses a paper panel with a deliberate left inset and two inset gold-edged cards.
  - Fix: added the paper-panel surface, `56px` left inset, right-side breathing room, stronger inner brass lines, centered CTAs, and a responsive desktop reduction.
- [P3] The target's cover has more ornamental embossing than the implementation.
  - Classification: accepted. The user previously rejected an AI-styled ornate cover and selected the current restrained realistic leather cover, so the plainer cover is an intentional product constraint rather than accidental drift.

## Required Fidelity Surfaces

- Fonts and typography: display/body hierarchy, centering, optical weight, and book-plate placement were corrected; post-fix wrapping still requires browser evidence.
- Spacing and layout rhythm: the lower section now has a framed left workbench, target-like left inset, equal entry tracks, centered actions, and the existing 50/50 book anchor; post-fix geometry still requires browser evidence.
- Colors and visual tokens: cinnabar, pine, muted brass, aged ivory, and walnut stay within the selected visual direction.
- Image quality and asset fidelity: the incorrect photographic fills were replaced by dedicated 1024 x 1536 ImageGen engravings, converted to high-quality project WebP assets; the existing realistic book raster is preserved intentionally.
- Copy and content: exactly two page entrances remain, `AI 生成资料` and `进入知识库`, with the selected destinations and no extra closed-state controls.

## Verification Completed

- Production build and TypeScript validation: passed; `43/43` static pages generated.
- Targeted resource-media suite: `7` passed.
- Source and pre-fix implementation were opened together in full-view and focused comparison sheets.
- Post-fix browser capture, hover verification, overflow check, and console-error check remain blocked by the Chrome binding failure.

## Comparison History

- Iteration 1: user capture exposed P1 drift in card imagery, hierarchy, framing, and book-plate alignment.
- Iteration 2: dedicated engraving assets and the structural CSS/component fixes above were applied. Build and targeted behavior tests passed, but no post-fix visual evidence could be captured from the user's explicitly selected Chrome surface.

final result: blocked

---

# 资源中心闭书双入口修订 Design QA

## Evidence

- Source visual truth: `/mnt/c/Users/Lenovo/.codex/generated_images/01a005ca-59d6-7b70-b92f-f33c95a9be2b/exec-9ef1d613-7bfb-45ab-ad12-187bf826c167.png`.
- Source pixels: `1616 x 969`.
- Implementation URL: `http://127.0.0.1:3000/desktop/resources/`.
- Intended viewport: signed-in desktop resource center, closed-book state, approximately `1388 x 1054` CSS pixels at density `1`.
- Implementation screenshot: unavailable. The in-app Browser control runtime rejected the WSL workspace URI before binding to the already-open tab, and the earlier local CDP endpoint is no longer exposed.

## Implemented Result

- The empty lower-left half is now a dedicated `资源工作台` shown only while the resource book is closed.
- Exactly two page entrances render: `AI 生成资料` routes to `/desktop/studio`, and `进入知识库` routes to `/desktop/kb`.
- Both entrances are equal-height, large tactile panels using the selected cinnabar and pine-green hierarchy, a single existing Lucide stroke family, and project-local raster imagery already used by the product.
- Upload, video, link, collection, batch-selection, publishing, and management entrances are intentionally absent from the closed-state workbench.
- The right closed book, cover scale, title plaque, hover animation, 50/50 split, and opening transition are unchanged.
- At the desktop route's narrow compatibility breakpoint, the extra workbench is hidden so it cannot overlap the full-width closed cover.

## Required Fidelity Surfaces

- Fonts and typography: the existing Chinese display-font stack, optical weights, and compact desktop copy hierarchy are reused; browser-rendered wrapping is not yet visually verified.
- Spacing and layout rhythm: code locks the workbench to `inset: 0 50% 0 0` and the two entrances to equal `1fr / 1fr` tracks; final rendered crop and perceived vertical balance are not yet visually verified.
- Colors and visual tokens: the implementation uses the selected muted cinnabar, forest green, ivory, brass, and ink palette without introducing neon, glass, or unrelated gradients.
- Image quality and asset fidelity: both panels use project-local raster assets (`profile-scholar-desk.png` and `scene-library.png`) as restrained material imagery; the cover continues to use the dedicated `resource-book-cover-v3.webp` raster.
- Copy and content: labels, descriptions, and destinations match the selected two-entry visual; regression coverage asserts exactly two links and rejects the removed entrance labels.

## Verification Completed

- Production build and TypeScript validation: passed; `43/43` static pages generated.
- Full frontend suite: `388` passed, `1` delivery-only test skipped.
- Targeted resource-media suite after adding the double-entry regression: `7` passed.
- `git diff --check` for the changed component and stylesheet: passed.
- Source visual opened and inspected at full resolution.

## Blocking QA Gap

- No browser-rendered implementation screenshot could be captured at the same viewport and state, so no combined source/implementation comparison exists.
- The workbench's actual typography, spacing, crop, hover state, and book alignment must be inspected in the user's open in-app Browser before visual fidelity can be marked passed.

final result: blocked

---

# 资源典藏关书交互 Design QA

> Historical section: this interaction was temporarily replaced by focused reading on 2026-08-18, then restored at the user's direction on 2026-08-19. The current implementation and the completed collection workflow are documented in `资源中心关书与集合管理修订` below.

## Evidence

- Source visual truth for the open state: the user's resource-center browser annotation at `1258 x 1054` CSS pixels.
- Source asset for the realistic closed state: `/mnt/c/Users/Lenovo/.codex/generated_images/01a005ca-59d6-7b70-b92f-f33c95a9be2b/exec-06cc0095-4422-4c45-9eca-945a531f4f8f.png`.
- Project master asset: `frontend/public/brand/resources/resource-book-cover-v3.png`, `1145 x 1374` RGBA PNG.
- Runtime animation asset: `frontend/public/brand/resources/resource-book-cover-v3.webp`, `768 x 922` RGBA WebP, `199,548` bytes.
- Implementation URL: `http://172.24.20.109:3000/desktop/resources/`.
- Implementation screenshot: unavailable because the in-app Browser control runtime rejected the workspace URI before it could bind to the existing tab.
- State: signed-in resource center with populated resources; open, closing, closed, and reopening states implemented.

## Implemented Changes

- Removed the annotated header action `生成新资料`; the contextual empty-state recovery action remains available only when the library is empty.
- Added a semantic close control to the top-left of the open folio toolbar.
- The first implementation rotated the complete interactive left-page DOM over `820ms`. The user reported visible frame stutter because the browser had to composite the search form, filters, scrollable catalog, resource rows, and cover texture as one 3D layer.
- The revised implementation keeps all live controls static and rotates only an isolated `desktop-resource-book-turning-leaf` layer over `680ms`. Its front reuses the project paper raster and its reverse uses the optimized leather-cover WebP.
- The animated layer is paint/layout-contained and GPU-promoted; reopening reveals the live left page only after the lightweight leaf passes the midpoint.
- A second user review found that the static open spread remained visible beneath the turning leaf, producing a duplicated-page impression. The motion now owns an opaque, neutral `desktop-resource-book-motion-underlay` for its complete duration, so the live left and right pages never render simultaneously with the moving folio.
- A third review found a perceptible stop at the upright `90°` position. The split `48% / 52%` keyframes were removed; close and open now use one uninterrupted `from / to` rotation and one easing curve for the full `680ms` duration.
- The closed book rests in the right half of the original spread, matching the direction and endpoint of the folding motion. Clicking its label reopens the same folio without resetting filters or the selected resource.
- The closed cover previously used `object-fit: contain` inside a padded button, making it visibly shorter than the open page. The padding is now zero and both static and turning cover faces fill the exact half-page plane.
- `新建集合` no longer uses `window.prompt` plus an unguarded `localStorage.setItem`. It opens an inline labeled form, persists signed-in collections through an account-scoped FastAPI endpoint and SQLite table, rejects duplicates and the 12-item limit, and retains a guarded local fallback only for offline mode.
- The first ornate concept was rejected as visibly AI-styled. The final asset uses plain worn leather, slight asymmetry, restrained oxidized brass, handmade-paper edges, no decorative fantasy motif, and a real transparent alpha channel.
- Reduced-motion users receive the same state change with a `1ms` transition, and both close/open controls retain keyboard focus treatment and accessible labels.

## Fidelity Review

- Fonts and typography: current product typography is preserved; the cover label remains editable UI text over the generated blank physical label. Browser-rendered alignment is not visually verified.
- Spacing and layout rhythm: the fold is structurally anchored at the exact `50 / 50` gutter. The closed asset is sized to the right-page slot. Browser-rendered crop and label alignment are not visually verified.
- Colors and tokens: subdued walnut, warm ivory, and oxidized brass match the existing resource-center palette; the earlier saturated and ornate treatment was removed.
- Image quality and asset fidelity: the project uses a dedicated RGBA ImageGen raster, not CSS art, a placeholder, inline SVG, or text glyph. The runtime copy preserves alpha while reducing transfer size from roughly `2.5 MB` to `199,548` bytes.
- Copy and content: the requested header CTA is absent; `收起书页`, `资源典藏`, and `点击展开书页` are the only new interaction labels.

## Verification Completed

- Targeted desktop/resource tests: `13` passed.
- Resource-collection backend tests: `2` passed.
- TypeScript check: passed.
- Production build: passed; `43/43` static pages generated.
- Route and final cover asset: HTTP `200`.

## Blocking QA Gap

- The open/closing/closed/reopening states could not be captured from the user's in-app Browser, so no normalized same-viewport comparison or interaction recording exists.
- Visual QA remains blocked until the live animation and final closed-book crop can be inspected in the in-app Browser.

final result: blocked

---

# 资源中心 50/50 对页修订 Design QA

## Evidence

- Source visual truth for integration/material: `/mnt/c/Users/Lenovo/.codex/generated_images/01a005ca-59d6-7b70-b92f-f33c95a9be2b/exec-11b1e6df-d4cb-485d-8415-7a57707f3d42.png`
- Source visual truth for the exact 50/50 split: `/mnt/c/Users/Lenovo/.codex/generated_images/01a005ca-59d6-7b70-b92f-f33c95a9be2b/exec-1199793c-478c-408d-9076-53e79bd20827.png`
- Implementation URL: `http://172.24.20.109:3000/desktop/resources/`
- Intended viewport: `1445 x 1089` CSS pixels, device scale factor `1`
- Source pixels: `1445 x 1089`
- Implementation screenshot: unavailable because the in-app Browser automation session could not initialize in this workspace.
- State: signed-in resource center with an approved generated-video resource selected.

## Implemented Changes

- The open-book workspace now uses `repeat(2, minmax(0, 1fr))`, locking the folio gutter to the exact horizontal midpoint.
- The left page owns a nested `典藏索引 + 资源列表` layout; the right page exclusively owns resource preview and actions.
- The first literal two-folio treatment was removed after the user reported that the book looked abrupt and disconnected from the page.
- A new single full-spread raster, `resource-spread-v3.png`, now sits once behind both live pages. It has a low-contrast paper surface, a centered shallow gutter, and restrained edge layering without a dark binding, bookmark, or floating shadow.
- The spread now uses a denser work-surface rhythm: the outer safety margin is `12px` per side at wide desktop sizes, the left page body uses `18px` side padding, and the right preview uses `28px / 24px` spine-to-edge padding instead of the previous `44px / 40px` inset.
- The left-page index is `168px`, approximately 30% of the usable half-page width, leaving the majority of the page for the resource list while preserving the book gutter.
- Search, type, status, source, sorting, clear-filter, collection, batch-selection, publishing, video-link, preview, path, theater, and export controls remain present.
- Compact list columns hide secondary row metadata inside the narrower left page while keeping the title, type, selection state, and approval state visible.

## Required Fidelity Surfaces

- Fonts and typography: existing Chinese display/body stacks and hierarchy are preserved in code; browser-rendered wrapping is not yet visually verified.
- Spacing and layout rhythm: the main split is structurally exact at `1fr / 1fr`; browser-rendered crop, edge padding, and gutter weight are not yet visually verified.
- Colors and visual tokens: existing ivory, walnut, cinnabar, pine, brass, and paper tokens are preserved.
- Image quality and asset fidelity: both pages share one project-local `resource-spread-v3.png` raster derived from the subtle integration reference; no placeholder, mirrored folio, or code-drawn book asset is used.
- Copy and content: current live labels, resource data, knowledge provenance, media links, and actions are preserved.

## Verification Completed

- TypeScript check: passed.
- Targeted resource and desktop tests: `11` passed.
- Full frontend suite: `384` passed, `1` delivery-only test skipped.
- Production build: passed; `43/43` static pages generated.
- Local route health: HTTP `200` at `/desktop/resources/`.

## Comparison History

- Iteration 1: the workspace used two complete folio images, one mirrored on the left and one on the right. The duplicated borders, dark central binding, bookmark, and shadow made the book read as a separate object. The user classified this as a major visual mismatch.
- Iteration 2: replaced both page images with one subtle spread asset behind the exact `1fr / 1fr` live layout; removed the dark spine, bookmark, duplicate page frames, and floating shadow. Browser-rendered comparison is still pending.
- Iteration 3: removed repeated outer and inner blank bands, reduced wide-desktop frame gutters from `17px` to `12px` per side, reduced left-page content padding from `28px` to `18px`, reduced right-preview padding from `44px / 40px` to `28px / 24px`, and tightened the two responsive desktop breakpoints. The folio remains structurally `50 / 50`.

## Blocking QA Gap

- The in-app Browser automation runtime rejected the current WSL workspace URI before a tab could be captured. Therefore no same-viewport implementation screenshot or combined source/implementation comparison exists for this revision.
- Visual QA remains blocked until the updated page can be captured from the in-app Browser and compared with the selected ImageGen reference.

final result: blocked

---

# 资源中心重做 Design QA

## Evidence

- Source visual truth: `/mnt/c/Users/Lenovo/.codex/generated_images/01a005ca-59d6-7b70-b92f-f33c95a9be2b/exec-2becc01c-c18f-46fb-ae52-5caae4504f3c.png`
- Implementation URL: `http://172.24.20.109:3000/desktop/resources/`
- Final exact-size generated-video state: `/mnt/d/816/design-audit/resource-visual/08-implemented-match-1445.png`
- External-video state: `/mnt/d/816/design-audit/resource-visual/06-implemented-external-video.png`
- Final exact-size comparison input: `/mnt/d/816/design-audit/resource-visual/09-reference-vs-implementation-1445.png`
- Target viewport: `1445 x 1088` CSS pixels, device scale factor `1`
- Source pixels: `1445 x 1088`; implementation pixels: `1445 x 1088`.
- State: signed-in QA account with approved learning materials, one generated-video record, and one external-video record. The selected resource is `归并排序：分治过程讲解`.

## Findings

- No actionable P0, P1, or P2 visual or functional issue remains after the user-reported overlap and fidelity pass.
- Fixed P1 overlap: the global teacher launcher previously covered the preview folio's lower-right actions. It is now omitted only on `/desktop/resources` and remains available on the other desktop routes; no preview, player, link, export, or batch control is covered.
- Fixed P2 folio fidelity: the flat rice-paper card was replaced with a project-local generated folio surface with a dark binding edge, layered page edges, restrained shadow, and cinnabar bookmark. Live HTML still owns every heading, player, link, provenance row, and action.
- Fixed P2 composition fidelity: the second pass restored the exact visual hierarchy that was still missing from the first implementation: the 174-pixel ink-wash hero, open `更多操作` menu, recent-learning strip, compact filter row, `典藏索引 / 新建集合`, batch action row, column labels, dense resource table, three preview tools, and two-column folio actions.
- Fixed P2 media fidelity: the generated-video preview now places status beside the title, uses the real poster with a centered play affordance, and keeps local-media and related-external-video controls on compact single rows like the approved direction.
- Fixed P2 information architecture: the resource top bar keeps `知识来源 / 视频学习 / 知识库` as standalone entrances. `知识库` remains the RAG-management route and is not represented as a user-resource category.
- Fixed P1 behavior issue: the first implementation emitted the browser event before the Studio browser panel mounted and persisted an obsolete panel key. The final implementation stores the target URL and the current v3 Studio panel state before navigation; live verification arrived at `/desktop/studio/` with `open=browser`, `rightOpen=true`, and the selected Bilibili URL restored.
- Accepted P3 content variation: live account rows, counts, timestamps, reference totals, and the real five-second media duration differ from the ImageGen direction because the implementation uses actual approved records rather than screenshot-only sample copy.

## Full-view Comparison Evidence

The final side-by-side input places the approved ImageGen direction and the live page at the same `1445 x 1088` viewport without scaling either image. The implementation preserves the direction's dark carved-wood rail, airy ink-wash header, recent-learning strip, labeled filter rail, catalog/list/open-folio proportions, dense row rhythm, generated-video player, layered page edge, red bookmark, link tools, and restrained pine/cinnabar/brass palette.

## Focused Comparison Evidence

The exact-size comparison keeps the selected generated-video row visible in the full catalog and table. The right folio exposes the real media URL, copy, play, download, related external video, RAG provenance, open, theater, path, and export actions; publish and delete remain available from the preview's three-dot menu. The separate external-video state confirms the original URL and internal-browser action.

## Required Fidelity Surfaces

- Typography: the established Chinese display/body stacks preserve the reference's Song-style editorial hierarchy, compact row copy, and readable metadata.
- Spacing and layout: measured geometry at the target viewport is hero `1196 x 174`, recent strip `1196 x 115`, toolbar `1196 x 52`, and workspace `1196 x 666`. No horizontal overflow was found at `1445`, `1280`, or `1110` CSS-pixel widths.
- Colors and tokens: aged ivory, dark walnut, cinnabar, pine green, and restrained brass use the existing desktop tokens.
- Image fidelity: the measured project-local raster assets provide the `16:9` video poster, blank folio surface, and wide ink-wash header. All three load in the real page; no CSS, SVG, or screenshot-only substitute is used for these visible assets.
- Copy and information architecture: `知识库` is not treated as a user-resource category. It is a standalone RAG-management entrance; resource rows expose only compact provenance such as `课程知识库 · N 条引用`.
- Icons and accessibility: one Lucide stroke family is used; navigation and actions are semantic links/buttons, resource search has a label, the video poster has alt text, selected rows expose pressed state, and disabled actions remain explicit.

## Primary Interactions Tested

- Standalone `知识库` shortcut reached `/desktop/kb/` and rendered `课程知识库`.
- Generated video: player, media link, copy, play, `下载 MP4`, and knowledge-provenance controls rendered from hydrated backend data.
- External video: one catalog row rendered from the safe backend summary; original URL and `在内置浏览器打开` were present.
- Internal-browser handoff reached `/desktop/studio/`, persisted the exact target URL, and opened the right browser panel.
- More-actions menu is open in the comparison state; publish-path and confirmed clear-center actions remain functional.
- Resource table exposes working search, four filters, sorting, collection creation, batch selection, selected-count, and publish-selected controls.
- Responsive checks at `1280 x 900` and `1110 x 860`: catalog, preview, and four filter controls remained visible; horizontal overflow was `0`.
- Browser console errors: none.
- Frontend targeted resource and desktop tests: `11` passed.
- Full frontend suite: `384` passed, `1` delivery-only test skipped.
- Backend targeted tests: `18` passed.
- Production build: passed after the final fidelity pass; `43/43` static pages generated.

## Backend Basis

- Material summaries expose only the safe public external-video fields required by the resource catalog; full material data remains behind the authenticated detail endpoint.
- Generated MP4 links continue to use the existing authenticated media-task association and `/api/media/video/{task_id}/file` path when a render is complete.
- RAG documents remain owned by the dedicated knowledge-base route and are not copied into the user's resource catalog.

## Final Assets

- `frontend/public/brand/resources/merge-sort-video-poster-v1.png`
- `frontend/public/brand/resources/resource-folio-v2.webp`
- `frontend/public/brand/resources/resource-center-hero-v3.webp`

final result: passed

---

# 资源中心专注阅读修订 Design QA

> Superseded on 2026-08-19: the user explicitly asked to remove focused reading and restore the close-book interaction. This section is retained only as decision history.

## Product Decision

- Removed `新建集合 / 我的集合`. A collection that cannot accept resources, filter the catalog, participate in publishing, or connect to a learning path is an empty abstraction rather than a useful product feature.
- Kept `学习路径合集`, which is derived from the user's actual learning paths and approved resources.
- Replaced decorative book closing with `专注阅读`: the left index and resource list collapse, while the selected resource preview expands across the full folio.

## Interaction And Accessibility

- The top-left control is a semantic button labeled `进入专注阅读`.
- Entering focus mode moves keyboard focus to `退出专注阅读`.
- `Escape` exits focus mode, and both button exit and keyboard exit return focus to the original entry control.
- Reduced-motion users receive the layout change without the workspace/page transition.

## Backend Scope

- Removed the unused manual-collection frontend client, FastAPI router, persistence model, and dedicated tests.
- The authenticated material catalog, learning-path resource collection, media links, RAG provenance, publishing, export, and deletion flows remain unchanged.
- No destructive database migration was run; an existing legacy table, if present in a developer database, is inert and no longer exposed by the application.

## Verification Completed

- Targeted resource and desktop tests: `13` passed.
- Production build and TypeScript validation: passed; `43/43` static pages generated.
- Resource-center route: HTTP `200`.
- Backend OpenAPI confirms `/api/resource-collections` is absent.
- `git diff --check`: passed.

## Blocking QA Gap

- The in-app Browser automation runtime still cannot bind to this WSL workspace URI, so the expanded focus state has not been captured at a normalized viewport.
- Functional and build verification pass; final same-viewport visual QA remains pending.

final result: blocked

---

# 资源中心关书与集合管理修订 Design QA

## Current Product Behavior

- Removed the temporary `专注阅读` state and all related controls, focus-mode layout rules, and keyboard handlers.
- Restored the isolated left-page close/open animation. The live resource controls are not rotated; a dedicated lightweight leaf turns over one opaque folio underlay, preventing duplicated live content during motion.
- The closed cover and open workspace share the same `666px` stage height. Closing moves the left half toward the right half; reopening reverses the same uninterrupted `680ms` rotation.
- Resource selection boxes render only while `批量选择` is active. Ordinary single-item selection uses the row highlight and approval status without a checkbox-like square.

## Collection Workflow

- `新建集合` opens a labeled editor where the user names the collection and selects any existing approved resources before saving.
- `我的集合` lists account-owned collections with real member counts. Selecting a collection filters the resource table; its management control supports rename, add/remove members, and two-step deletion.
- The batch toolbar can add selected resources to an existing collection or create a new collection with those resources already selected.
- Collections store only approved material IDs belonging to the signed-in account. Other-account, missing, and unapproved IDs are rejected by the API.
- Deleted or stale material IDs are omitted when collections are read, so collection counts and filters do not expose missing resources.

## Persistence And Compatibility

- Added authenticated `GET / POST / PUT / DELETE /api/resource-collections` endpoints and account-scoped SQLite persistence.
- The earlier name-only prototype table was migrated in place by adding `resource_ids` and `updated_at`; all existing collection names and ordering were preserved.
- The migration is idempotent and does not delete or recreate the existing table.
- Offline mode retains an account-keyed local fallback, while signed-in live mode always uses the backend.

## Verification Completed

- Frontend resource/desktop tests: `13` passed.
- Backend collection, migration, material-catalog, and authentication tests: `16` passed.
- Production build and TypeScript validation: passed; `43/43` static pages generated.
- Live backend restart completed; resource-collection routes are present in OpenAPI and unauthenticated access correctly returns `401`.
- Existing database migration completed with all four prior collection rows preserved.

## Visual QA Gap

- In-app Browser control could not bind to the WSL workspace URI, so no normalized screenshot or click recording was captured for the restored animation and collection dialog.
- Code, build, database, route, and permission checks pass; final motion/spacing review remains pending in the user's open browser.

final result: blocked

---

# 发现页方案 1 Design QA

## Evidence

- Source visual truth: `/mnt/d/816/design-audit/discover-visual/01-theme-scroll.png`
- Implementation URL: `http://172.24.20.109:3000/desktop/discover/`
- Final implementation screenshot: `/mnt/d/816/design-audit/discover-visual/25-scheme1-implementation-final.png`
- Responsive screenshot: `/mnt/d/816/design-audit/discover-visual/26-scheme1-responsive-final.png`
- Full-view comparison: `/mnt/d/816/design-audit/discover-visual/27-scheme1-comparison-final.png`
- Focused comparison: `/mnt/d/816/design-audit/discover-visual/28-scheme1-focus-final.png`
- Target viewport: `1487 x 1058` CSS pixels, device scale factor `1`
- Source pixels: `1487 x 1058`
- Implementation pixels: `1487 x 1058`
- Responsive viewport: `1024 x 900` CSS pixels, device scale factor `1`
- State: signed-in temporary QA account, `发现` selected, global draggable teacher launcher collapsed.

## Findings

- No actionable P0, P1, or P2 issue remains in the final comparison.
- P3 image variation: the generated scroll map omits the source's tiny readable node labels, the old pine is denser, and the market thumbnails use newly generated scenes. Subjects, crops, palette, and hierarchy remain faithful, so these are accepted natural asset variations.
- P3 product constraint: the real draggable teacher launcher is larger than the visual-only launcher in the source mock. It remains outside the primary CTAs at the target viewport and does not block the main journey.

## Full-view Comparison Evidence

The source and implementation were combined at identical viewport and pixel dimensions. The implementation matches the option-1 information architecture and visual cadence: panoramic editorial scroll, `今日策展` hero copy and cinnabar CTA, large recommended interactive-learning feature, three-row course market, and the bottom path-continuity notice. Existing shell, sidebar, top bar, account state, and draggable teacher are intentionally retained from the product.

## Focused Region Comparison Evidence

The focused sheet uses the same crop coordinates for both main-content regions. Hero height, two-column split, lower-card height, typography scale, button placement, list density, and bottom notice align with the source. The final real seal asset removes the earlier code-drawn approximation.

## Required Fidelity Surfaces

- Fonts and typography: the established Chinese display stack preserves the source's Song-style editorial hierarchy. Kai-style supporting labels, body copy, course metadata, line height, tracking, and truncation remain readable at both tested widths.
- Spacing and layout rhythm: the target keeps the `388 px` hero, `20 px` lower-grid gap, `405 px` feature/list cards, and `86 px` assurance strip. At `1024 px`, the lower grid becomes a single column without overlap or horizontal overflow.
- Colors and tokens: ivory rice paper, charcoal ink, aged sepia, cinnabar red, muted pine green, and restrained brass align with the established desktop palette. No modern gradient treatment was introduced.
- Image quality and asset fidelity: all five scene slots use project-local raster assets with correct subject, crop, scale, and shared art direction. The `学枢` seal is a real source-derived raster asset; no placeholder illustration, custom SVG, or CSS-drawn logo remains.
- Copy and content: hero copy, interactive-learning description, tags, course titles, categories, lesson counts, and continuity notice match the selected option's intended standalone experience.
- Icons and accessibility: standard directional/compass icons use the existing icon library; images have descriptive alt text, decorative imagery is hidden appropriately, primary controls are semantic links, visible focus states are defined, and motion is disabled under reduced-motion preferences.

## Comparison History

- Iteration 1 — `/mnt/d/816/design-audit/discover-visual/21-scheme1-implementation-v1.png` and `/mnt/d/816/design-audit/discover-visual/23-scheme1-comparison-v1.png`: the option-1 composition already matched, but the hero seal was recreated as styled HTML and tablet copy contrast was weaker over the art. These were P2 asset-fidelity and responsive-legibility shortcuts.
- Fixes: replaced the seal with `/brand/discover/discover-seal-v1.png`; reduced hero-art opacity and shifted its focal point at `1180 px` and below.
- Final iteration — `/mnt/d/816/design-audit/discover-visual/25-scheme1-implementation-final.png`, `/mnt/d/816/design-audit/discover-visual/26-scheme1-responsive-final.png`, and the combined final comparisons: no P0, P1, or P2 issue remains.

## Primary Interactions Tested

- `开始探索` and `进入互动课堂` navigate to `/desktop/theater/`.
- The market header, three course rows, and footer action navigate to `/desktop/market/`.
- All six option-1 raster assets loaded with non-zero natural dimensions.
- Horizontal overflow: `false` at `1487 x 1058` and `1024 x 900`.
- Production build: passed.
- Targeted desktop tests: `11` passed.

## Final Assets

- `frontend/public/brand/discover/discover-scroll-hero-v1.png`
- `frontend/public/brand/discover/discover-maze-pine-v1.png`
- `frontend/public/brand/discover/discover-seal-v1.png`
- `frontend/public/brand/discover/market-algorithm-v1.png`
- `frontend/public/brand/discover/market-history-v1.png`
- `frontend/public/brand/discover/market-poetry-v1.png`

final result: passed

---

# 发现页方案 2 Design QA

## Evidence

- Source visual truth: `/mnt/d/816/design-audit/discover-visual/02-dual-gates.png`
- Implementation URL: `http://172.24.20.109:3000/desktop/discover/`
- Exact-size implementation screenshot: `/mnt/d/816/design-audit/discover-visual/18-implementation-exact-final.png`
- Full comparison sheet: `/mnt/d/816/design-audit/discover-visual/19-comparison-exact-final.png`
- Focused gateway comparison: `/mnt/d/816/design-audit/discover-visual/20-gateway-comparison-exact-final.png`
- Responsive evidence: `/mnt/d/816/design-audit/discover-visual/17-responsive-final.png`
- Target viewport: `1487 x 1058` CSS pixels, device scale factor `1`
- Source pixels: `1487 x 1058`
- Implementation pixels: `1487 x 1058`
- Responsive viewport: `1024 x 900` CSS pixels, device scale factor `1`
- State: signed-in temporary QA account, `发现` selected, global teacher launcher collapsed.

## Full-view Comparison Evidence

The source and implementation were placed side by side at the same viewport and pixel dimensions. The implementation preserves the existing 学枢 shell while matching the selected dual-gateway hierarchy: recommendation ribbon, concise discovery header, two framed ink-wash destinations, door plaques, vertical category tags, primary actions, and the assurance strip.

## Focused Region Comparison Evidence

The focused comparison covers both gateways at matched crop coordinates. The final pass corrected the category-tag height so the title, supporting copy, and action no longer sit visibly lower than the source. The implementation intentionally keeps the doors inside the responsive card bounds and uses the existing draggable teacher component rather than reproducing its smaller visual-only mock.

## Required Fidelity Surfaces

- Fonts and typography: the existing Song-style display stack and Kai-style label stack are retained; title, body, vertical tag, and button hierarchy follow the source. Static header and gateway copy match the selected direction.
- Spacing and layout rhythm: the recommendation/header/gateway/assurance cadence matches the reference at `1487 x 1058`; the gateway grid stacks at `1180 px` and below without horizontal overflow.
- Colors and tokens: aged ivory paper, dark walnut, cinnabar red, pine green, and muted brass stay within the established desktop palette. No unrelated gradient or generic dashboard treatment was introduced.
- Image quality and asset fidelity: both gateway scenes are project-bound raster assets generated for their measured slots, with correct subject, crop, palette, and density. There are no placeholder images, CSS illustrations, or handcrafted SVG substitutes.
- Copy and content: both destinations, `二叉树迷宫课堂`, `本周精选 24 讲`, and the five market themes are coherent and visible. The recommendation, support copy, and assurance language remain product-specific.
- Icons and accessibility: Lucide icons keep one stroke family; decorative icons are hidden from assistive technology, scene images have descriptive alt text, primary controls are semantic links, and keyboard focus treatment is present.

## Comparison History

- Iteration 1: the first implementation retained generic explanatory copy and its header density drifted from the selected source. This P2 mismatch was fixed by restoring the exact discovery title and supporting sentence.
- Iteration 2: the full and focused comparison showed category tags were too tall, pushing both content groups approximately one line lower than the source. This P2 spacing mismatch was fixed by reducing tag padding, font size, and letter spacing.
- Final iteration: exact-size comparison at `1487 x 1058` shows no remaining P0, P1, or P2 fidelity issue. Remaining P3 differences are limited to natural ImageGen scene variation, slightly softer illustration contrast, responsive containment of the door plaques, and the existing teacher launcher's larger product-sized footprint.

## Primary Interactions Tested

- `/desktop/theater/`: clicked successfully from the recommendation and interactive-teaching destination.
- `/desktop/market/`: clicked successfully from the market destination.
- Horizontal overflow: `false` at `1487 x 1058`, `1440 x 1024`, and `1024 x 900`.
- Production build: passed.
- Targeted desktop tests: `11` passed.

## Final Assets

- `frontend/public/brand/discover/discover-interactive-gate-v1.png`
- `frontend/public/brand/discover/discover-market-gate-v1.png`

final result: passed

---

# 当前交付状态

- Active direction: 方案 1（主题卷轴）. This supersedes the archived 方案 2 QA section above.
- Source visual truth: `/mnt/d/816/design-audit/discover-visual/01-theme-scroll.png`
- Final implementation screenshot: `/mnt/d/816/design-audit/discover-visual/25-scheme1-implementation-final.png`
- Exact-size comparison: `/mnt/d/816/design-audit/discover-visual/27-scheme1-comparison-final.png`
- Responsive evidence: `/mnt/d/816/design-audit/discover-visual/26-scheme1-responsive-final.png`
- Current findings, fixes, interaction results, and asset inventory are recorded in `发现页方案 1 Design QA` above.
- The two unused 方案 2 gateway assets were removed from the project after confirming no source references remained; their earlier QA evidence is kept only as history.

final result: passed

---

# 浏览器标注更新 Design QA

## Evidence

- Source visual truth: the three browser annotations on the current 方案 1 implementation, grounded by `/mnt/d/816/design-audit/discover-visual/01-theme-scroll.png`.
- Final top-state screenshot: `/mnt/d/816/design-audit/discover-visual/31-annotations-exact-top-final.png`
- Final bottom-state screenshot: `/mnt/d/816/design-audit/discover-visual/32-annotations-exact-bottom-final.png`
- Exact-size comparison: `/mnt/d/816/design-audit/discover-visual/33-annotations-comparison-final.png`
- Annotated viewport evidence: `/mnt/d/816/design-audit/discover-visual/29-annotations-top-final.png` and `/mnt/d/816/design-audit/discover-visual/30-annotations-bottom-final.png`
- Exact comparison viewport: `1487 x 1058` CSS pixels, device scale factor `1`; source and implementation pixels both `1487 x 1058`.
- Annotation viewport: `1388 x 1054` CSS pixels, device scale factor `1`.
- State: signed-in desktop Discover page, global teacher closed to its default bubble state; bottom evidence is scrolled to the animated panorama.

## Findings

- No actionable P0, P1, or P2 issue remains.
- P3: the compact teacher bubble overlaps a small decorative corner of the panorama when the page is scrolled fully down. It does not cover copy, navigation, or a primary control, and remains draggable by design.

## Comparison And Fidelity Review

- Typography and copy: the scheme-1 title, course hierarchy, and editorial spacing are unchanged. The removed continuity notice is replaced by concise `学习漫游 / 山水之间，探索继续` copy that stays subordinate to the course content.
- Spacing and layout rhythm: the old `86 px` assurance strip is removed. The `210 px` panorama supplies intentional vertical closure without changing hero or course-card geometry.
- Colors and tokens: the new panorama uses the same rice-paper, warm sepia, charcoal, cinnabar, and muted pine palette.
- Image quality: `/brand/discover/discover-journey-panorama-v1.png` is a project-local ImageGen raster with correct crop, density, and shared art direction; there is no placeholder, CSS illustration, or custom SVG substitute.
- Behavior and accessibility: the teacher's closed state is a `64 x 64` semantic button with a visible focus ring, persisted drag position, and an accessible label. Clicking it opens the full teacher dialog. The panorama uses slow image transform animation and disables animation when reduced motion is requested.

## Primary Interactions Tested

- Teacher bubble measured `64 x 64`, opened successfully, and exposed the full `[role=dialog]` teacher interface.
- `开始探索` rendered with `href=/desktop/market/`, clicked successfully, and arrived at `/desktop/market/`.
- The former assurance copy is absent from the component and the animated journey figure/image are present and loaded.
- Horizontal overflow: `false` at `1388 x 1054` and `1487 x 1058`.
- Production build: passed.
- Targeted desktop tests: `11` passed.

## Final Asset

- `frontend/public/brand/discover/discover-journey-panorama-v1.png`

final result: passed

# Resource Center Design QA

**Source visual truth**

- Approved reference: `C:/Users/Lenovo/.codex/generated_images/01a01a4f-479f-7070-ac83-176a99f192f1/exec-efa58d23-5fc3-499d-a70b-df703c7215d0.png`
- Source pixels: 1526 × 1030.
- Density normalization: resized once to 1536 × 1024 for a same-size comparison; the aspect-ratio adjustment is under 1% on each axis.

**Implementation evidence**

- Closed state: `D:/816/tmp/resource-center-design-qa/resource-center-closed-1536-pass2.png`
- Opening state: `D:/816/tmp/resource-center-design-qa/resource-center-opening-1536-pass2.png`
- Full-view comparison: `D:/816/tmp/resource-center-design-qa/resource-center-design-qa-pass2.png`
- Focused lower-workspace comparison: `D:/816/tmp/resource-center-design-qa/resource-center-design-qa-focused-pass2.png`
- Browser URL: `http://127.0.0.1:3000/desktop/resources/?category=materials`
- CSS viewport: 1536 × 1024; implementation pixels: 1536 × 1024; device pixel ratio: 1.
- Primary state: closed resource book with the two entrances and learning activity visible.

**Findings**

- No actionable P0, P1, or P2 differences remain.
- Typography: the existing display and sans-serif families, weights, line heights, truncation, and small-text hierarchy remain consistent with the product and the approved reference. The two entrance labels and five activity rows remain legible without collision at the target viewport.
- Spacing and layout: the large book remains the dominant right-side element, the entrances keep the approved two-column proportion, the activity list occupies the lower-left card, and the full lower composition now fits in the 1536 × 1024 target viewport.
- Colors and tokens: parchment, ochre, cinnabar, pine green, leather brown, borders, and low-elevation shadows stay within the existing resource-center palette. No new gradient was introduced.
- Image quality: the original book cover and entrance engravings are reused. The missing backdrop is a project-local WebP with natural paper texture, restrained library linework, and a walnut baseline; it is not approximated with CSS art or inline SVG.
- Copy and content: the approved workbench labels and five learning-activity entries are present. Icons use the product's existing Lucide family and consistent stroke weights.
- P3 acceptable variance: the generated reference compresses the global desktop sidebar slightly and shows more architectural linework in its outer margins. The implementation preserves the real app shell and keeps the new linework quieter so it does not reintroduce the heavy AI-generated look the user rejected.

**Focused comparison**

- The focused crop covers y=320–1024 in both normalized source and implementation. It was required because the entrance copy, activity-row rhythm, book label, bottom wood baseline, and background treatment are too small to judge reliably in the full-view pair alone.
- The focused evidence confirms that both entrance images keep their intended crop, all five activity rows are visible, and the book cover remains sharp and unobstructed.

**Interaction and resilience checks**

- Closed → opening: the entrance panels and activity panel leave while the cover and paper bundle begin moving; the book is not delayed until after the left-side exit.
- Opening → open: the existing multi-page riffle completes and the resource spread remains usable.
- 1100 × 800: the two entrance cards remain side by side and do not overlap the book. The activity list remains available by the existing page scroll.
- 960 × 800: the existing desktop-shell fallback intentionally hides the auxiliary workbench and keeps the book as the primary control; no new element overlap was introduced.
- Reduced-motion behavior keeps the exit immediate instead of running the new panel motion.
- Browser console check after closed/open interaction: no errors or warnings; only React DevTools information and the HMR connection log were present.

**Comparison history**

1. Pass 1 — blocked by one P2 layout mismatch: the 704px minimum book stage pushed the fifth activity row and walnut baseline below the 1536 × 1024 viewport. Evidence: `D:/816/tmp/resource-center-design-qa/resource-center-design-qa-pass1.png`.
2. Fix — reduced the responsive book stage to 648–720px, compacted the resource header to the reference height, and versioned the persisted view state so the old 704px default does not pin the revised layout.
3. Pass 2 — the complete activity card, book cover, and bottom baseline are visible together; the full-view and focused comparisons show no remaining P0/P1/P2 mismatch.

**Implementation checklist**

- [x] Keep the existing large leather book and flip system.
- [x] Add only the missing lower-area background asset.
- [x] Match the approved two-entrance workbench layout.
- [x] Add the five-row learning activity panel.
- [x] Preserve simultaneous entrance exit and book opening.
- [x] Verify target and narrower desktop viewports.
- [x] Check console output and reduced-motion fallback.

final result: passed
