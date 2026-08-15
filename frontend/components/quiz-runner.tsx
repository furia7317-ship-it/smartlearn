"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  gradeQuizSubmission,
  isQuizAnswerCorrect,
  type QuizSubmission,
} from "@/lib/practice-feedback";
import type { QuizQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

const LETTERS = "ABCDEFGHIJ".split("");

/** 选项前缀字母：优先用「A.」前缀，没有就按序号推导 */
function optionLetter(opt: string, idx: number): string {
  const m = opt.trim().match(/^([A-Za-z])\s*[.、:：)）]/);
  return m ? m[1].toUpperCase() : LETTERS[idx] ?? String(idx + 1);
}

/** 去掉「A.」前缀后的选项正文 */
function optionText(opt: string): string {
  return opt.replace(/^([A-Za-z])\s*[.、:：)）]\s*/, "").trim();
}

/** 标准答案归一化为字母（"A. xxx" / "B、" → "A"/"B"） */
function normLetter(ans?: string): string {
  if (!ans) return "";
  const m = ans.trim().match(/[A-Za-z]/);
  return m ? m[0].toUpperCase() : ans.trim();
}

function isMcq(q: QuizQuestion): boolean {
  return Array.isArray(q.options) && q.options.length > 0;
}

export function QuizRunner({
  questions,
  initialAnswers,
  reviewMode = false,
  onClose,
  onSubmit,
}: {
  questions: QuizQuestion[];
  /** 回顾模式的既有作答（题号 → 字母/文本） */
  initialAnswers?: Record<string, string>;
  /** 直接以已提交状态展示（错题回顾） */
  reviewMode?: boolean;
  onClose?: () => void;
  onSubmit?: (submission: QuizSubmission) => void;
}) {
  const qs = useMemo(
    () => questions.filter((q) => q && q.stem),
    [questions]
  );
  const keyOf = (q: QuizQuestion, i: number) => q.id ?? `q${i}`;

  const [answers, setAnswers] = useState<Record<string, string>>(
    initialAnswers ?? {}
  );
  const [submitted, setSubmitted] = useState(reviewMode);

  const answeredCount = qs.filter((q, i) => answers[keyOf(q, i)]).length;
  const submission = useMemo(() => gradeQuizSubmission(qs, answers), [answers, qs]);
  const { correctCount, score } = submission;

  const pick = (qk: string, letter: string) => {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [qk]: letter }));
  };

  const reset = () => {
    setAnswers({});
    setSubmitted(false);
  };

  const submit = () => {
    const result = gradeQuizSubmission(qs, answers);
    setSubmitted(true);
    onSubmit?.(result);
  };

  if (qs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
        这份试卷暂无题目内容。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 评分条 */}
      {submitted && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl border px-4 py-3",
            score >= 80
              ? "border-success/40 bg-success/[0.07]"
              : score >= 60
                ? "border-warning/40 bg-warning/[0.07]"
                : "border-danger/40 bg-danger/[0.07]"
          )}
        >
          <span
            className={cn(
              "font-mono text-3xl font-bold tabular-nums",
              score >= 80 ? "text-success" : score >= 60 ? "text-warning" : "text-danger"
            )}
          >
            {score}
          </span>
          <div className="text-[12px] leading-tight">
            <div className="font-semibold">
              答对 {correctCount}/{qs.length} 题 · 掌握度 {score}%
            </div>
            <div className="text-muted-foreground">
              {score >= 80
                ? "掌握扎实，继续保持"
                : score >= 60
                  ? "基本掌握，错题需复盘"
                  : "薄弱点较多，建议回看讲义后重做"}
            </div>
          </div>
          {!reviewMode && (
            <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={reset}>
              <RotateCcw className="size-3.5" />
              再做一遍
            </Button>
          )}
        </div>
      )}

      {/* 题目 */}
      <div className="space-y-4">
        {qs.map((q, qi) => {
          const qk = keyOf(q, qi);
          const chosen = answers[qk];
          const correct = isQuizAnswerCorrect(q, chosen);
          const ansLetter = normLetter(q.answer);

          return (
            <section key={qk} className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-md bg-muted font-mono text-[11px] font-semibold tabular-nums">
                  {qi + 1}
                </span>
                {/* 题干走统一 Markdown：LLM 出的编程/高数题常含 `代码`、**加粗** 与 $公式$。
                    字号/行高留在外层，md-tight 内部 font-size:inherit 继承，视觉零位移。 */}
                <div className="flex-1 text-[13px] font-medium leading-relaxed">
                  <Markdown content={q.stem} className="md-tight" />
                </div>
                {submitted && (
                  <span
                    className={cn(
                      "shrink-0 text-[11px] font-medium",
                      correct ? "text-success" : "text-danger"
                    )}
                  >
                    {correct ? "正确" : chosen ? "错误" : "未作答"}
                  </span>
                )}
              </div>

              {isMcq(q) ? (
                <div className="mt-2.5 space-y-1.5">
                  {q.options!.map((opt, oi) => {
                    const letter = optionLetter(opt, oi);
                    const isPicked = chosen === letter;
                    const isAnswer = submitted && letter === ansLetter;
                    const isWrongPick = submitted && isPicked && letter !== ansLetter;
                    return (
                      <button
                        key={letter + oi}
                        disabled={submitted}
                        onClick={() => pick(qk, letter)}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] leading-relaxed transition-colors duration-150",
                          !submitted && isPicked && "border-primary/60 bg-primary/[0.06]",
                          !submitted && !isPicked && "hover:border-primary/40",
                          isAnswer && "border-success/50 bg-success/[0.07]",
                          isWrongPick && "border-danger/50 bg-danger/[0.07]",
                          submitted && !isAnswer && !isWrongPick && "opacity-55"
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[11px] font-semibold",
                            !submitted && isPicked && "border-primary bg-primary text-primary-foreground",
                            isAnswer && "border-success bg-success text-white",
                            isWrongPick && "border-danger bg-danger text-white"
                          )}
                        >
                          {letter}
                        </span>
                        {/* 选项保持紧凑单行排版，但要能出行内代码与公式 */}
                        <span className="flex-1">
                          <Markdown inline content={optionText(opt)} className="md-tight" />
                        </span>
                        {isAnswer && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
                        {isWrongPick && <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2.5">
                  <input
                    value={chosen ?? ""}
                    disabled={submitted}
                    onChange={(e) => pick(qk, e.target.value)}
                    placeholder="在此作答…"
                    className="h-9 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
                  />
                  {submitted && (
                    <p className="mt-1.5 text-[12px]">
                      <span className="text-muted-foreground">参考答案：</span>
                      <span className="font-medium text-success">
                        <Markdown inline content={q.answer ?? ""} className="md-tight" />
                      </span>
                    </p>
                  )}
                </div>
              )}

              {submitted && !correct && q.explanation && (
                <div className="mt-3 rounded-lg border border-danger/20 bg-danger/[0.03] px-3.5 py-2.5">
                  <div className="text-[11px] font-semibold text-danger">
                    AI 批改 · {chosen ? "错题解析" : "未作答解析"}
                  </div>
                  <div className="mt-1 font-kai text-[13.5px] leading-relaxed text-foreground/90">
                    <Markdown content={q.explanation} className="md-tight" />
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* 底部操作 */}
      {!submitted && (
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={answeredCount === 0} className="gap-1.5">
            提交并评分
          </Button>
          <span className="text-[12px] text-muted-foreground">
            已作答 {answeredCount}/{qs.length}
            {answeredCount < qs.length && " · 未作答按错处理"}
          </span>
          {onClose && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
              关闭
            </Button>
          )}
        </div>
      )}
      {submitted && (
        <p className="text-[11px] text-muted-foreground">
          AI 仅批改错误题和未作答题；答对的题目只记录结果，不重复生成讲解。
        </p>
      )}
    </div>
  );
}
