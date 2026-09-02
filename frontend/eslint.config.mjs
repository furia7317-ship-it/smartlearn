import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "**/.next/**",
    "out/**",
    "build/**",
    "dist-electron/**",
    ".electron-app/**",
    ".electron-app-*.tmp/**",
    "runtime/**",
    "coverage/**",
    // Third-party prebuilt SDK bundles are immutable runtime assets, not app source.
    "public/vendor/**",
    "public/voice-assets/**",
    "public/sandbox-runtime/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // 客户端壳需要在挂载/会话回灌 effect 中同步 React 状态。
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["electron/**/*.js"],
    rules: {
      // Electron 主进程与 preload 仍以 CommonJS 运行。
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
