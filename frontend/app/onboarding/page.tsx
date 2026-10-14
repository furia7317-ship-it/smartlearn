"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { MajorCatalogCombobox } from "@/components/major-catalog-combobox";
import { Button } from "@/components/ui/button";
import { AuthRequestError, type MajorCatalogEntry, type MajorLevel } from "@/lib/auth";
import { DEFAULT_GRADE, GRADES, isUndergraduateGrade, normalizeGrade } from "@/lib/user-settings";
import { cn } from "@/lib/utils";
import { WelcomeHandbook } from "@/components/welcome/welcome-handbook";
import styles from "./onboarding.module.css";

const PREFERENCES = [
  { id: "图示讲解", detail: "用结构图和动画理解概念" },
  { id: "文字精读", detail: "通过完整讲义逐层梳理" },
  { id: "动手练习", detail: "边做题或写代码边掌握" },
  { id: "案例驱动", detail: "从真实问题进入知识点" },
  { id: "先总后分", detail: "先看全局框架再学细节" },
  { id: "循序渐进", detail: "按难度稳定推进" },
];
const STEPS = ["基本学情", "学习偏好", "学习目标"];

export default function OnboardingPage() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { user, completeOnboarding } = useAuth();
  const [step, setStep] = useState(0);
  const [readingHandbook, setReadingHandbook] = useState(true);
  const [direction, setDirection] = useState(1);
  const [grade, setGrade] = useState(normalizeGrade(user?.grade || DEFAULT_GRADE));
  const [selectedMajor, setSelectedMajor] = useState<MajorCatalogEntry | null>(null);
  const [preferences, setPreferences] = useState<string[]>(user?.preferences || []);
  const [longGoal, setLongGoal] = useState(user?.long_term_goal || "");
  const [midGoal, setMidGoal] = useState(user?.mid_term_goal || "");
  const [shortGoal, setShortGoal] = useState(user?.short_term_goal || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const majorLevel: MajorLevel = isUndergraduateGrade(grade)
    ? "undergraduate"
    : "graduate";
  const stepReady = step === 0 ? selectedMajor !== null : step === 1 ? preferences.length > 0 : true;

  const validateStep = () => {
    if (step === 0 && !selectedMajor) return "请从教育部专业目录的检索结果中选择专业";
    if (step === 1 && preferences.length === 0) return "请至少选择一项学习偏好";
    return "";
  };

  const move = (nextStep: number) => {
    if (nextStep > step) {
      const validationError = validateStep();
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setError("");
    setDirection(nextStep > step ? 1 : -1);
    setStep(nextStep);
  };

  const togglePreference = (preference: string) => {
    setPreferences((current) => current.includes(preference)
      ? current.filter((item) => item !== preference)
      : [...current, preference]);
    setError("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < STEPS.length - 1) {
      move(step + 1);
      return;
    }
    const validationError = validateStep();
    if (validationError || saving) {
      if (validationError) setError(validationError);
      return;
    }

    setSaving(true);
    setError("");
    try {
      await completeOnboarding({
        grade,
        major: selectedMajor!.name,
        major_code: selectedMajor!.code,
        major_level: selectedMajor!.level,
        preferences,
        long_term_goal: longGoal.trim(),
        mid_term_goal: midGoal.trim(),
        short_term_goal: shortGoal.trim(),
      });
      router.replace("/desktop");
    } catch (caught) {
      setError(caught instanceof AuthRequestError ? caught.message : "学情保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={styles.scene}>
      <AnimatePresence mode="wait" initial={false}>
      <motion.div key={readingHandbook ? "handbook" : "profile"}
        initial={reduceMotion ? false : { opacity: 0, y: 24, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={reduceMotion ? undefined : { opacity: 0, y: -16, filter: "blur(3px)" }}
        transition={{ duration: reduceMotion ? 0 : .45, ease: [.22, 1, .36, 1] }}
        className={styles.stage}
      >
      {readingHandbook ? <WelcomeHandbook onContinue={() => setReadingHandbook(false)} /> : <section
        className={styles.setup}
        aria-labelledby="onboarding-title"
      >
        <header className={styles.header}><div><span>学枢 · 新生入学</span><h1 id="onboarding-title">建立你的学习档案</h1></div><button type="button" onClick={() => setReadingHandbook(true)}>重看入门手册 <span aria-hidden>↗</span></button></header>
        <div className={styles.setupFrame}>
          <aside className={styles.journey}>
            <p className={styles.eyebrow}>认识你，是教好你的第一步</p><h2>从你的起点，<br />走向你的目标。</h2>
            <p>花一点时间，让智能教师了解你的学习阶段与习惯，为接下来的学习找到合适的节奏。</p>
            <ol aria-label="设置进度">{STEPS.map((label, index) => <li key={label} data-active={index === step} data-complete={index < step} aria-current={index === step ? "step" : undefined}><span>{index < step ? "✓" : String(index + 1).padStart(2, "0")}</span><div><strong>{label}</strong><small>{["了解目前的学习基础", "找到适合你的学习方式", "明确下一步想做到的事", "邀请码或查找教师已建立的班级"][index]}</small></div></li>)}</ol>
            <p className={styles.journeyNote}>这些选择都可以在设置中修改。<br />你的学习画像，会随着真实学习逐步完善。</p>
          </aside>
        <form onSubmit={submit} className={styles.form}>
          <div className={styles.formBody}>
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <motion.div
                key={step}
                custom={direction}
                initial={reduceMotion ? false : { opacity: 0, x: direction * 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, x: direction * -14 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                {step === 0 && (
                  <div>
                    <h2 className="text-base font-semibold">你目前处于哪个学习阶段？</h2>
                    <p className="mt-1 text-sm text-[#756a59]">课程难度和术语深度会据此调整。</p>
                    <fieldset className="mt-5">
                      <legend className="text-sm font-medium">年级</legend>
                      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {GRADES.map((item) => (
                          <label key={item} className={cn(
                            "grid h-10 cursor-pointer place-items-center rounded-md border text-sm transition-colors",
                            grade === item ? "border-[#8b5b18] bg-[#8b5b18] text-white" : "border-[#d8cbb7] bg-white hover:border-[#a47a42]",
                          )}>
                            <input
                              type="radio"
                              name="grade"
                              value={item}
                              checked={grade === item}
                              onChange={() => {
                                const nextLevel: MajorLevel = isUndergraduateGrade(item)
                                  ? "undergraduate"
                                  : "graduate";
                                setGrade(item);
                                if (nextLevel !== majorLevel) setSelectedMajor(null);
                                setError("");
                              }}
                              className="sr-only"
                            />
                            {item}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="mt-6 text-sm font-medium">
                      <span>专业</span>
                      <MajorCatalogCombobox
                        key={majorLevel}
                        level={majorLevel}
                        selected={selectedMajor}
                        onSelect={setSelectedMajor}
                        onTouched={() => setError("")}
                      />
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div>
                    <h2 className="text-base font-semibold">你更习惯怎样学习？</h2>
                    <p className="mt-1 text-sm text-[#756a59]">可以多选，之后仍可在设置中修改。</p>
                    <fieldset className="mt-5 grid gap-2 sm:grid-cols-2">
                      <legend className="sr-only">学习偏好</legend>
                      {PREFERENCES.map((item) => {
                        const selected = preferences.includes(item.id);
                        return (
                          <label key={item.id} className={cn(
                            "flex min-h-16 cursor-pointer items-center gap-3 rounded-md border px-3.5 py-2.5 transition-colors",
                            selected ? "border-[#8b5b18] bg-[#f7eddd]" : "border-[#d8cbb7] bg-white hover:border-[#a47a42]",
                          )}>
                            <input type="checkbox" checked={selected} onChange={() => togglePreference(item.id)} className="sr-only" />
                            <span className={cn("grid size-5 shrink-0 place-items-center rounded border", selected ? "border-[#8b5b18] bg-[#8b5b18] text-white" : "border-[#b6a78f]")}>
                              {selected && <Check className="size-3.5" aria-hidden />}
                            </span>
                            <span className="min-w-0">
                              <strong className="block text-sm font-medium">{item.id}</strong>
                              <span className="mt-0.5 block text-xs text-[#756a59]">{item.detail}</span>
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                  </div>
                )}

                {step === 2 && (
                  <div>
                    <h2 className="text-base font-semibold">你希望学习带来什么结果？</h2>
                    <p className="mt-1 text-sm text-[#756a59]">目标可暂时不填；填写后会进入学习画像，并参与总学习路径编排。</p>
                    <div className="mt-5 grid gap-3">
                      {[
                        { label: "长期目标", hint: "半年及以上", value: longGoal, setter: setLongGoal, placeholder: "如：具备独立完成专业项目的能力" },
                        { label: "中期目标", hint: "一个月至半年", value: midGoal, setter: setMidGoal, placeholder: "如：本学期系统掌握数据结构" },
                        { label: "短期目标", hint: "一个月以内", value: shortGoal, setter: setShortGoal, placeholder: "如：两周内掌握线性表与链表" },
                      ].map((item) => (
                        <label key={item.label} className="grid gap-1.5 sm:grid-cols-[110px_1fr] sm:items-start">
                          <span className="pt-2 text-sm font-medium">{item.label}<small className="mt-0.5 block font-normal text-[#8a7c67]">{item.hint} · 可不填</small></span>
                          <textarea
                            value={item.value}
                            onChange={(event) => { item.setter(event.target.value); setError(""); }}
                            rows={2}
                            placeholder={item.placeholder}
                            className="min-h-16 resize-none rounded-md border border-[#d8cbb7] bg-white px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-[#8b5b18] focus:ring-2 focus:ring-[#8b5b18]/15"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <footer className={styles.formFooter}>
            <div className="min-w-0 flex-1">
              {error && <p role="alert" className="text-xs text-[#983f3d]">{error}</p>}
            </div>
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => move(step - 1)} disabled={saving} className="border-[#cdbfa9] bg-white">
                <ChevronLeft className="size-4" aria-hidden />返回
              </Button>
            )}
            <Button type="submit" disabled={saving || !stepReady} className={styles.next}>
              {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : step === STEPS.length - 1 ? <Check className="size-4" aria-hidden /> : null}
              {saving ? "保存中" : step === STEPS.length - 1 ? "完成设置" : <>继续<ChevronRight className="size-4" aria-hidden /></>}
            </Button>
          </footer>
        </form>
        </div>
        <p className={styles.setupNote}>入门手册 <span>—</span> 学习档案 <span>—</span> 认识书房 <span>—</span> 开始学习</p>
      </section>}
      </motion.div>
      </AnimatePresence>
    </main>
  );
}
