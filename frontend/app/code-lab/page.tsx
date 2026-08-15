"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Play, RotateCcw, Sparkles, TerminalSquare } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { executeCodeWithReview, type CodeExecutionResponse } from "@/lib/code-lab";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "sl_web_python_code_lab_v1";
const STARTER_CODE = `def average(numbers):
    total = sum(numbers)
    return total / len(numbers)


scores = [86, 92, 78, 95]
print("平均分:", average(scores))`;

export default function CodeLabPage() {
  const [code, setCode] = useState(STARTER_CODE);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CodeExecutionResponse | null>(null);
  const [error, setError] = useState("");
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved?.trim()) setCode(saved);
    } catch {
      // The editor remains usable without local persistence.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, code);
      } catch {
        // Ignore unavailable storage.
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [code]);

  const lines = useMemo(
    () => Array.from({ length: Math.max(1, code.split(/\r?\n/).length) }, (_, index) => index + 1),
    [code],
  );

  const run = async () => {
    if (!code.trim() || running) return;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      setResult(await executeCodeWithReview(code, "用户在 Web 学习工作台主动练习 Python。"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRunning(false);
    }
  };

  const reset = () => {
    setCode(STARTER_CODE);
    setResult(null);
    setError("");
  };

  const execution = result?.execution;
  const diagnosis = result?.diagnosis;

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader title="代码挑战" eyebrow="学习工具">
          <span className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground">Python 3</span>
          <Button variant="outline" size="icon-sm" onClick={reset} aria-label="恢复示例代码" title="恢复示例代码">
            <RotateCcw className="size-4" />
          </Button>
          <Button onClick={() => void run()} disabled={running || !code.trim()} className="gap-1.5">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? "运行与诊断中" : "运行代码"}
          </Button>
        </PageHeader>

        <div className="grid min-h-[620px] overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(480px,1.25fr)_minmax(340px,0.85fr)]">
          <section className="min-w-0 border-b lg:border-b-0 lg:border-r" aria-label="代码编辑器">
            <div className="flex h-10 items-center justify-between border-b bg-muted/25 px-4 text-[11px] text-muted-foreground">
              <span className="font-mono">main.py</span>
              <span>Ctrl + Enter 运行</span>
            </div>
            <div className="relative h-[580px] overflow-hidden bg-zinc-950">
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 overflow-hidden border-r border-white/10 bg-zinc-950/95 pt-4 text-right font-mono text-[13px] leading-6 text-zinc-600">
                <div style={{ transform: `translateY(${-scrollTop}px)` }}>
                  {lines.map((line) => <div key={line} className="h-6 pr-3">{line}</div>)}
                </div>
              </div>
              <textarea
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    void run();
                  }
                  if (event.key === "Tab") {
                    event.preventDefault();
                    const target = event.currentTarget;
                    const start = target.selectionStart;
                    const end = target.selectionEnd;
                    setCode(`${code.slice(0, start)}    ${code.slice(end)}`);
                    window.requestAnimationFrame(() => {
                      target.selectionStart = target.selectionEnd = start + 4;
                    });
                  }
                }}
                spellCheck={false}
                aria-label="Python 代码编辑器"
                className="thin-scroll absolute inset-0 resize-none bg-transparent py-4 pl-16 pr-5 font-mono text-[13px] leading-6 text-zinc-100 outline-none selection:bg-cyan-700/50"
              />
            </div>
          </section>

          <aside className="thin-scroll min-w-0 overflow-y-auto" aria-label="运行结果与 AI 诊断">
            <section className="border-b p-4">
              <div className="mb-3 flex items-center gap-2">
                <TerminalSquare className="size-4" />
                <h2 className="text-sm font-semibold">运行输出</h2>
                {execution && <span className="ml-auto text-[10px] text-muted-foreground">{execution.execution_time_ms.toFixed(1)} ms</span>}
              </div>
              <pre className={cn("min-h-28 whitespace-pre-wrap rounded-lg px-3 py-3 font-mono text-[12px] leading-relaxed", execution?.error ? "bg-red-950 text-red-100" : "bg-zinc-900 text-zinc-100")}>
                {error
                  ? error
                  : execution?.error
                    ? `${execution.error.type}${execution.error.line ? ` · 第 ${execution.error.line} 行` : ""}\n${execution.error.message}`
                    : execution?.stdout || (running ? "正在运行..." : "运行代码后在此查看输出。")}
              </pre>
            </section>

            <section className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">AI 代码诊断</h2>
              </div>
              {diagnosis ? (
                <div className="space-y-3">
                  <p className="text-[13px] leading-relaxed text-foreground/85">{diagnosis.summary}</p>
                  {diagnosis.issues.map((issue, index) => (
                    <article key={`${issue.title}:${index}`} className="rounded-lg border p-3">
                      <div className="flex items-start gap-2">
                        {issue.severity === "info"
                          ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-info" />
                          : <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", issue.severity === "error" ? "text-danger" : "text-warning")} />}
                        <div className="min-w-0">
                          <h3 className="text-xs font-semibold">{issue.title}{issue.line ? ` · 第 ${issue.line} 行` : ""}</h3>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{issue.explanation}</p>
                          {issue.suggestion && <p className="mt-2 border-l-2 border-primary pl-2 text-[11px] leading-relaxed">{issue.suggestion}</p>}
                        </div>
                      </div>
                    </article>
                  ))}
                  <div className="rounded-lg border border-primary/25 bg-primary/[0.05] p-3 text-[12px] leading-relaxed">
                    <strong>下一步：</strong>{diagnosis.next_step}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed px-4 py-10 text-center text-xs text-muted-foreground">
                  运行代码后，AI 会结合真实输出和报错指出问题与改进方向。
                </p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
