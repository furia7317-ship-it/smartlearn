import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("resource center separates RAG knowledge base from user resources", async () => {
  const [shell, resources] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../components/desktop/desktop-resources.tsx"),
  ]);

  assert.doesNotMatch(shell, /href="\/desktop\/(?:kb|video-learning)"/);
  assert.match(resources, /href="\/desktop\/kb"/);
  assert.match(resources, /AI 生成依据：课程知识库/);
  assert.doesNotMatch(resources, /知识库文档/);
  assert.match(resources, /external-video/);
  assert.match(resources, /外部视频链接/);
});

test("resource subpages return safely after the global topbar is removed", async () => {
  const [shell, styles, create, kb, video, backButton] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../app/desk-study.css"),
    read("../components/desktop/desktop-create.tsx"),
    read("../components/desktop/desktop-kb.tsx"),
    read("../components/desktop/desktop-video-learning.tsx"),
    read("../components/desktop/resource-center-back-button.tsx"),
  ]);

  assert.doesNotMatch(shell, /desktop-topbar|topbar-academy-scroll-v1\.webp/);
  assert.match(shell, /desktop-rail-account/);
  assert.match(create, /<ResourceCenterBackButton/);
  assert.match(kb, /<ResourceCenterBackButton/);
  assert.match(video, /<ResourceCenterBackButton/);
  assert.match(backButton, /getResourceCenterReturnHref\(\)/);
  assert.match(backButton, /router\.push/);
  assert.doesNotMatch(backButton, /router\.back/);
  assert.match(styles, /\.desktop-resource-return/);
});

test("closed resource book exposes only AI generation and knowledge base page entrances", async () => {
  const [resources, styles] = await Promise.all([
    read("../components/desktop/desktop-resources.tsx"),
    read("../app/desk-study.css"),
  ]);

  const start = resources.indexOf('<section className="desktop-resource-closed-workbench"');
  const end = resources.indexOf("</section>", start);
  const workbench = resources.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal((workbench.match(/<Link /g) || []).length, 2);
  assert.match(workbench, /href="\/desktop\/create"/);
  assert.doesNotMatch(workbench, /href="\/desktop\/studio"/);
  assert.match(workbench, /AI 生成资料/);
  assert.match(workbench, /href="\/desktop\/kb"/);
  assert.match(workbench, /进入知识库/);
  assert.match(workbench, /resource-entry-ai-engraving-v1\.webp/);
  assert.match(workbench, /resource-entry-kb-engraving-v1\.webp/);
  assert.match(workbench, /我的学习动态/);
  assert.match(workbench, /查看全部动态/);
  assert.doesNotMatch(workbench, /上传资料|生成视频|添加视频链接|新建集合|批量选择/);
  assert.match(styles, /resource-center-library-backdrop-v1\.webp/);
  assert.match(styles, /resource-center-bookshelf-empty-v1\.webp/);
  assert.match(resources, /<nav className="desktop-resource-bookshelf" aria-label="书架功能入口">[\s\S]{0,360}href="\/desktop\/practice"[\s\S]{0,260}进入练习模块/);
  assert.match(resources, /desktop-resource-shelf-book is-practice/);
  assert.match(resources, /desktop-resource-shelf-book is-reserved is-pine/);
  assert.match(resources, /desktop-resource-shelf-book is-reserved is-ochre/);
  assert.match(resources, /shelf-book-practice-original-v1\.webp/);
  assert.match(resources, /shelf-book-pine-original-v1\.webp/);
  assert.match(resources, /shelf-book-ochre-original-v1\.webp/);
  assert.match(resources, />练习<\/strong>/);
  assert.match(styles, /\.desktop-resource-shelf-books\s*\{[\s\S]{0,240}height:\s*65\.4%[\s\S]{0,100}gap:\s*clamp\(1px, \.12cqw, 3px\)/);
  assert.match(styles, /\.desktop-resource-shelf-book > img\s*\{[\s\S]{0,200}object-fit:\s*contain/);
  assert.match(styles, /\.desktop-resource-shelf-book\.is-practice:hover,[\s\S]{0,240}transform:\s*translateY\(-10%\)/);
  assert.match(styles, /\.desktop-resource-shelf-book\.is-practice:active\s*\{[\s\S]{0,180}translateY\(-14%\)/);
  assert.match(styles, /\.desktop-resource-shelf-book__label\s*\{[\s\S]{0,760}writing-mode:\s*vertical-rl/);
  assert.match(styles, /\.desktop-resource-shelf-book\.is-practice:focus-visible/);
  assert.match(styles, /desktop-resource-closed-workbench[\s\S]{0,180}inset:\s*8px calc\(50% \+ 42px\) 34px 24px/);
  assert.match(styles, /desktop-resource-closed-workbench__entrances[\s\S]{0,180}grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@keyframes desktop-resource-closed-entry-arrive/);
  assert.match(styles, /desktop-resource-book-shell\.is-closed \.desktop-resource-closed-entry[\s\S]{0,220}animation:\s*desktop-resource-closed-entry-arrive/);
  assert.match(styles, /desktop-resource-closed-entry\.is-kb[\s\S]{0,100}--resource-entry-delay:\s*190ms/);
  assert.match(styles, /desktop-resource-closed-entry::after[\s\S]{0,420}desktop-resource-closed-entry-glint/);
  assert.match(styles, /@keyframes desktop-resource-closed-entry-leave/);
  assert.match(styles, /desktop-resource-book-shell\.is-entry-exiting \.desktop-resource-closed-entry[\s\S]{0,260}animation:\s*desktop-resource-closed-entry-leave/);
  assert.match(styles, /desktop-resource-closed-entry\.is-kb[\s\S]{0,120}--resource-entry-exit-delay:\s*0ms/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*no-preference\)/);
  assert.match(resources, /RESOURCE_ENTRY_EXIT_MS = 420/);
  assert.match(resources, /setEntryExitActive\(true\);\s*setBookState\("opening"\);\s*entryExitTimerRef\.current = window\.setTimeout/);
  assert.match(resources, /setTimeout\(\(\) => \{[\s\S]{0,160}setEntryExitActive\(false\)/);
  assert.match(resources, /entryExitActive && "is-entry-exiting"/);
  await access(new URL("../public/brand/resources/resource-center-library-backdrop-v1.webp", import.meta.url));
});

test("generated videos expose playback, copy, download, and source-link actions", async () => {
  const resources = await read("../components/desktop/desktop-resources.tsx");

  assert.match(resources, /media_file_url/);
  assert.match(resources, /本地成片链接/);
  assert.match(resources, /copyText\(mediaFileUrl/);
  assert.match(resources, /download><Download/);
  assert.match(resources, /内置浏览器打开/);
  assert.match(resources, /openInBrowser\(url\)/);
  assert.match(resources, /BROWSER_URL_KEY/);
  assert.match(resources, /sl_studio_panels_v3/);
  assert.match(resources, /open: "browser"/);
  assert.doesNotMatch(resources, /sl_studio_panel_v1/);
  await access(new URL("../public/brand/resources/merge-sort-video-poster-v1.png", import.meta.url));
});

test("resource folio keeps dense resource actions unobstructed", async () => {
  const [shell, resources, styles] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../components/desktop/desktop-resources.tsx"),
    read("../app/desk-study.css"),
  ]);

  assert.match(shell, /<DesktopTeacherLauncher railCollapsed=\{railCollapsed\}/);
  assert.match(resources, /desktop-resource-left-page/);
  assert.match(resources, /desktop-resource-left-page__body/);
  assert.match(styles, /resource-spread-v3\.webp/);
  assert.match(styles, /resource-center-hero-v3\.webp/);
  assert.match(styles, /desktop-resource-preview__tools/);
  assert.match(styles, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /grid-template-columns:\s*168px minmax\(0, 1fr\)/);
  assert.match(styles, /padding:\s*0 18px 22px/);
  assert.match(styles, /padding:\s*20px 24px 24px 28px/);
  await access(new URL("../public/brand/resources/resource-spread-v3.webp", import.meta.url));
  await access(new URL("../public/brand/resources/resource-center-hero-v3.webp", import.meta.url));
});

test("resource folio uses the same hard-cover page-flip mechanism as 智学云枢", async () => {
  const [resources, flip, styles, packageJson] = await Promise.all([
    read("../components/desktop/desktop-resources.tsx"),
    read("../components/desktop/resource-book-flip.tsx"),
    read("../app/desk-study.css"),
    read("../package.json"),
  ]);

  const header = resources.slice(
    resources.indexOf('<header className="desktop-resource-center__header">'),
    resources.indexOf("</header>")
  );
  assert.doesNotMatch(header, /生成新资料/);
  assert.doesNotMatch(header, /更多操作|desktop-resource-center__header-actions|desktop-resource-more/);
  assert.match(styles, /\.desktop-resource-center__header\s*\{[\s\S]{0,420}resource-center-hero-v3\.webp[\s\S]{0,180}background-position:\s*center bottom[\s\S]{0,120}background-size:\s*100% 100%/);
  assert.match(resources, /type ResourceBookState = "open" \| "closing" \| "closed" \| "opening"/);
  assert.match(resources, /aria-label="收起书页"/);
  assert.match(resources, /aria-label="展开资源典藏"/);
  assert.match(resources, /resource-book-cover-v3\.webp/);
  assert.match(resources, /ResourceBookFlip/);
  assert.match(resources, /bookFlipReady && "has-book-flip-overlay"/);
  assert.match(packageJson, /"page-flip": "\^2\.0\.7"/);
  assert.match(flip, /import \{ PageFlip \} from "page-flip"/);
  assert.match(flip, /coverPage\.dataset\.density = "hard"/);
  assert.match(flip, /RESOURCE_PAPER_PAGE_COUNT = 12/);
  assert.match(flip, /createPaperRiffle/);
  assert.match(flip, /host\.append\(coverPage, leftPage, rightPage\)/);
  assert.match(flip, /return <div ref=\{hostRef\} className="desktop-resource-page-flip"/);
  assert.match(flip, /pageFlip\.destroy\(\)[\s\S]{0,120}parent\.insertBefore\(host, nextSibling\)/);
  assert.match(flip, /showCover:\s*true/);
  assert.match(flip, /drawShadow:\s*true/);
  assert.match(flip, /maxShadowOpacity:\s*0\.5/);
  assert.match(flip, /RESOURCE_BOOK_FLIP_TOTAL_MS = 800/);
  assert.match(flip, /--resource-paper-duration", `\$\{RESOURCE_BOOK_FLIP_TOTAL_MS\}ms`/);
  assert.doesNotMatch(flip, /resource-paper-delay/);
  assert.match(flip, /flippingTime:\s*flipDuration/);
  assert.match(flip, /pageFlip\.on<number>\("flip"/);
  assert.match(flip, /cloneVisualPage/);
  assert.match(flip, /pageFlip\.flipNext\("top"\)/);
  assert.match(flip, /pageFlip\.flipPrev\("top"\)/);
  assert.match(flip, /paperRiffle\.classList\.add\("is-running"\)/);
  assert.match(flip, /pageFlip\.loadFromHTML\(\[coverPage, leftPage, rightPage\]\)/);
  assert.match(flip, /querySelector<HTMLElement>\("\.stf__block"\)[\s\S]{0,40}appendChild\(paperRiffle\)/);
  assert.match(styles, /desktop-resource-book-closed[\s\S]{0,420}background:\s*transparent/);
  assert.match(styles, /desktop-resource-book-closed[\s\S]{0,180}inset:\s*0 0 0 50%/);
  assert.match(styles, /desktop-resource-book-closed > img[\s\S]{0,240}width:\s*113\.11%/);
  assert.match(styles, /desktop-resource-book-closed > img[\s\S]{0,280}object-fit:\s*fill/);
  assert.match(styles, /desktop-resource-book-closed > span[\s\S]{0,120}top:\s*34\.9%/);
  assert.match(styles, /desktop-resource-book-closed > span[\s\S]{0,360}background:\s*transparent/);
  assert.match(styles, /desktop-resource-book-closed:hover[\s\S]{0,180}scale\(1\.03\) rotateY\(-5deg\)/);
  assert.match(styles, /prefers-reduced-motion:\s*no-preference/);
  assert.match(styles, /desktop-resource-page-flip\.is-ready/);
  assert.match(styles, /desktop-resource-page-flip\.stf__parent[\s\S]{0,100}position:\s*absolute/);
  assert.match(styles, /has-book-flip-overlay > \.desktop-resource-workspace[\s\S]{0,80}visibility:\s*hidden/);
  assert.match(styles, /desktop-resource-center__frame[\s\S]{0,140}width:\s*100%/);
  assert.doesNotMatch(styles, /desktop-resource-center__frame[\s\S]{0,140}width:\s*calc\(100% - (?:18|24|44)px\)/);
  assert.match(styles, /desktop-resource-center__frame[\s\S]{0,140}container-type:\s*inline-size/);
  assert.match(styles, /--resource-book-height:\s*max\([\s\S]{0,120}clamp\(420px, 42cqw, 640px\)/);
  assert.match(resources, /--resource-book-content-height/);
  assert.match(resources, /RESOURCE_BOOK_MAX_WIDE_HEIGHT = 720/);
  assert.match(resources, /Math\.ceil\(bounds\.width \/ 2\)/);
  assert.doesNotMatch(resources, /Math\.ceil\(bounds\.height\)/);
  assert.match(styles, /desktop-resource-book-shell[\s\S]{0,180}min-height:\s*var\(--resource-book-height\)/);
  assert.match(resources, /bookTransitionLockRef/);
  await access(new URL("../public/brand/resources/resource-center-bookshelf-empty-v1.webp", import.meta.url));
  assert.match(resources, /bookTransitionSequenceRef/);
  assert.match(resources, /ResizeObserver\(measure\)/);
  assert.match(flip, /if \(disposed \|\| completed\) return/);
  assert.match(flip, /const remaining = flipDuration - \(performance\.now\(\) - startedAt\)/);
  assert.match(styles, /desktop-resource-flip-page\.is-cover > span[\s\S]{0,180}top:\s*34\.9%/);
  assert.match(styles, /desktop-resource-page-riffle\.is-opening\.is-running/);
  assert.match(styles, /desktop-resource-paper-bundle-open/);
  assert.match(styles, /desktop-resource-paper-bundle-close/);
  assert.doesNotMatch(resources, /focusMode|专注阅读|focusExitRef|focusToggleRef/);
  await access(new URL("../public/brand/resources/resource-book-cover-v3.webp", import.meta.url));
});

test("resource catalog persists real collections and only renders selectors in batch mode", async () => {
  const [resources, collectionsApi, backendRouter, backendModel, backendMain] = await Promise.all([
    read("../components/desktop/desktop-resources.tsx"),
    read("../lib/resource-collections.ts"),
    read("../../backend/app/routers/resource_collections.py"),
    read("../../backend/app/models/learning.py"),
    read("../../backend/app/main.py"),
  ]);

  assert.match(resources, /学习路径合集/);
  assert.match(resources, /buildPathResourceCollection/);
  assert.match(resources, /新建集合/);
  assert.match(resources, /我的集合/);
  assert.match(resources, /createResourceCollection/);
  assert.match(resources, /updateResourceCollection/);
  assert.match(resources, /desktop-resource-collection-editor__resources/);
  assert.match(resources, /\{marketSelecting && <span className=\{cn\("desktop-resource-selectbox"/);
  assert.doesNotMatch(resources, /desktop-resource-selectbox", selected && !marketSelecting/);
  assert.match(collectionsApi, /credentials: "include"/);
  assert.match(collectionsApi, /api\/resource-collections/);
  assert.match(backendRouter, /invalid_collection_resources/);
  assert.match(backendRouter, /GeneratedMaterial\.student_id == student_id/);
  assert.match(backendModel, /class ResourceCollection/);
  assert.match(backendMain, /resource_collections\.router/);
  assert.doesNotMatch(resources, /window\.prompt/);
});

test("desktop modules restore their stable state after navigation", async () => {
  const [shell, transition, resources, resourceView, moduleView, moduleHook] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../components/layout/desktop-page-transition.tsx"),
    read("../components/desktop/desktop-resources.tsx"),
    read("../lib/resource-center-view.ts"),
    read("../lib/desktop-module-view.ts"),
    read("../hooks/use-desktop-module-view-state.ts"),
  ]);

  assert.match(shell, /getDesktopModuleReturnHref/);
  assert.match(shell, /rememberDesktopModuleHref/);
  assert.match(transition, /onScrollCapture=\{rememberScroll\}/);
  assert.match(transition, /scrollPath: window\.location\.pathname/);
  assert.match(resources, /readResourceCenterView/);
  assert.match(resources, /saveResourceCenterView/);
  assert.match(resources, /restoredSelectedKeyRef/);
  assert.match(resources, /ref=\{resourceScrollRef\}/);
  assert.match(resourceView, /sessionStorage/);
  assert.match(resourceView, /bookState: ResourceCenterStableBookState/);
  assert.match(resourceView, /bookHeight: number/);
  assert.match(resourceView, /RESOURCE_CENTER_BOOK_MAX_HEIGHT = 720/);
  assert.doesNotMatch(resourceView, /Math\.min\(1_600, (?:parsed|next)\.bookHeight\)/);
  assert.match(resourceView, /selectedKey: string/);
  assert.match(moduleView, /type DesktopModuleId/);
  assert.match(moduleView, /"home"[\s\S]*"studio"[\s\S]*"path"[\s\S]*"resources"[\s\S]*"practice"[\s\S]*"discover"/);
  assert.match(moduleView, /scrollTops: Record<string, number>/);
  assert.match(moduleView, /values: Record<string, unknown>/);
  assert.match(moduleHook, /useDesktopModuleStringState/);
});
