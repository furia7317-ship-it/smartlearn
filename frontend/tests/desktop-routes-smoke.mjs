const baseUrl = (process.argv[2] || process.env.SMARTLEARN_DESKTOP_URL || "http://localhost:3000")
  .replace(/\/$/, "");

const routes = [
  "/desktop/",
  "/desktop/studio/",
  "/desktop/create/",
  "/desktop/path/",
  "/desktop/path/study/",
  "/desktop/resources/",
  "/desktop/theater/",
  "/desktop/practice/",
  "/desktop/kb/",
  "/desktop/diagnostic/",
  "/desktop/profile/",
  "/desktop/settings/",
  "/desktop/video-learning/",
];

// Keep the probe sequential: the local development/static servers are intentionally
// single-process and concurrent fetches can race their connection queue, producing
// false network failures even when every route is healthy.
const results = [];
for (const route of routes) {
  try {
    const response = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
    results.push({ route, status: response.status, ok: response.status >= 200 && response.status < 300 });
  } catch (error) {
    results.push({
      route,
      status: "network-error",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

console.table(results.map(({ route, status }) => ({ route, status })));

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  const summary = failures
    .map((failure) => `${failure.route}: ${failure.status}${failure.detail ? ` (${failure.detail})` : ""}`)
    .join("\n");
  throw new Error(`Desktop route smoke failed against ${baseUrl}:\n${summary}`);
}

console.log(`Desktop route smoke passed: ${routes.length}/${routes.length} returned 2xx from ${baseUrl}`);
