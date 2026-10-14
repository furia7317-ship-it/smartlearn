import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { observeNearViewport } from "../lib/near-viewport.ts";

function observerHarness() {
  let callback, options, target, disconnected = 0;
  class Observer {
    constructor(cb, opts) { callback = cb; options = opts; }
    observe(element) { target = element; }
    disconnect() { disconnected++; }
  }
  return { Observer, fire: (visible) => callback([{ isIntersecting: visible }]),
    get options() { return options; }, get target() { return target; },
    get disconnected() { return disconnected; } };
}

test("offscreen image is deferred; entering viewport reveals only once", () => {
  const h = observerHarness(), element = {};
  let reveals = 0;
  const cancel = observeNearViewport(element, () => reveals++, h.Observer);
  assert.equal(h.target, element);
  assert.deepEqual(h.options, { rootMargin: "120px 0px", threshold: 0 });
  h.fire(false);
  assert.equal(reveals, 0);
  h.fire(true);
  h.fire(true);
  assert.equal(reveals, 1);
  assert.equal(h.disconnected, 1);
  cancel();
});

test("unmount ignores late callbacks; unsupported browsers still show image", () => {
  const h = observerHarness();
  let reveals = 0;
  const cancel = observeNearViewport({}, () => reveals++, h.Observer);
  cancel(); h.fire(true);
  assert.equal(reveals, 0);
  observeNearViewport({}, () => reveals++, undefined)();
  assert.equal(reveals, 1);
});

test("lazy artwork retains image boxes, original sources and only the hero preloads", async () => {
  const read = (file) => readFile(new URL(file, import.meta.url), "utf8");
  const [image, discover, market] = await Promise.all([
    read("../components/viewport-image.tsx"),
    read("../components/desktop/desktop-discover.tsx"),
    read("../components/desktop/desktop-market.tsx"),
  ]);
  assert.match(image, /src=\{visible \? src : EMPTY_IMAGE\}/);
  assert.match(image, /ref=\{image\}/);
  assert.doesNotMatch(image, /<div|<span/);
  assert.match(discover, /<Image[\s\S]*?discover-scroll-hero-v1\.png[\s\S]*?preload/);
  assert.equal((discover.match(/\bpreload\b/g) || []).length, 1);
  assert.doesNotMatch(discover, /\bpriority\b/);
  assert.match(discover, /<ViewportImage\s+src="\/brand\/discover\/discover-maze-pine-v1\.png"/);
  assert.match(discover, /<ViewportImage\s+src="\/brand\/discover\/discover-journey-panorama-v1\.png"/);
  assert.match(discover, /<ViewportImage\s+src=\{item.image\}/);
  assert.match(market, /<ViewportImage src=\{MARKET_COVERS\[listing.kind\]\}/);
});

test("public cache policy excludes APIs/pages and returns real static 404s", async () => {
  const config = await readFile(new URL("../deploy/nginx.tencent.conf", import.meta.url), "utf8");
  for (const prefix of ["brand", "audio", "voice-assets"]) {
    const block = config.split(`location ^~ /${prefix}/ {`)[1].split("}")[0];
    assert.match(block, /try_files \$uri =404/);
    assert.match(block, /public, max-age=3600, must-revalidate/);
    assert.doesNotMatch(block, /immutable|Cache-Control[^;]*always|index\.html/);
  }
  const api = config.split("location ^~ /backend/ {")[1].split("}")[0];
  assert.match(api, /proxy_cache off/);
  assert.doesNotMatch(api, /public|expires/);
  assert.match(config, /Cache-Control "no-cache"/);
  assert.match(config, /public, max-age=31536000, immutable/);
});
