import assert from "node:assert/strict";
import test from "node:test";

import { toSpeakableText } from "../lib/speech-text.ts";

test("digital-human speech keeps prose but removes Markdown markers and URLs", () => {
  const spoken = toSpeakableText(`
# **核心结论**

- [栈与队列](https://example.com/stack) 都是线性结构
- \`栈\` 遵循 **后进先出**
> 这是重点。
  `);

  assert.equal(spoken, "核心结论。栈与队列 都是线性结构。栈 遵循 后进先出。这是重点。");
  assert.doesNotMatch(spoken, /[#*`>\[\]]|https?:\/\//);
});

test("digital-human speech turns tables and code fences into natural narration", () => {
  const spoken = toSpeakableText(`
| 概念 | 复杂度 |
| --- | --- |
| 查找 | O(n) |

\`\`\`python
print("hello")
\`\`\`
  `);

  assert.equal(spoken, "概念 ， 复杂度。查找 ， O(n)。这里有一段代码示例。");
  assert.doesNotMatch(spoken, /\||```|print/);
});

test("digital-human speech preserves image descriptions without reading asset URLs", () => {
  const spoken = toSpeakableText("请看 ![二叉树遍历示意图](https://cdn.example.com/tree.png)。");

  assert.equal(spoken, "请看 图片：二叉树遍历示意图。");
});
