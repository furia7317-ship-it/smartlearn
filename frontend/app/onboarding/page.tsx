"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, GraduationCap, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { MajorCatalogCombobox } from "@/components/major-catalog-combobox";
import { Button } from "@/components/ui/button";
import { AuthRequestError, type MajorCatalogEntry, type MajorLevel } from "@/lib/auth";
import { DEFAULT_GRADE, GRADES, isUndergraduateGrade, normalizeGrade } from "@/lib/user-settings";
import { cn } from "@/lib/utils";

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
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#f5efe3] px-4 py-8 text-[#2d261b]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[#8b5b18]" />
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[760px]"
        aria-labelledby="onboarding-title"
      >
        <header className="mb-5 flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#3a2b17] text-[#fffaf0]">
            <GraduationCap className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 id="onboarding-title" className="text-xl font-semibold tracking-normal">建立你的学习档案</h1>
            <p className="mt-0.5 text-sm text-[#756a59]">这些信息会用于规划课程节奏和学习内容</p>
          </div>
          <span className="ml-auto font-mono text-xs text-[#756a59]">{step + 1} / {STEPS.length}</span>
        </header>

        <div className="mb-3 grid grid-cols-3 gap-2" aria-label="设置进度">
          {STEPS.map((label, index) => (
            <div key={label} className="min-w-0">
              <div className={cn("h-1 rounded-full transition-colors duration-300", index <= step ? "bg-[#8b5b18]" : "bg-[#d8cbb7]")} />
              <span className={cn("mt-1.5 block truncate text-xs", index === step ? "font-medium text-[#3a2b17]" : "text-[#8a7c67]")}>{label}</span>
            </div>
          ))}
        </div>

        <form onSubmit={submit} className="overflow-hidden rounded-lg border border-[#d8cbb7] bg-[#fffdf8] shadow-[0_18px_55px_rgba(58,43,23,0.09)]">
          <div className="min-h-[390px] p-5 sm:p-7">
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

          <footer className="flex min-h-16 items-center gap-3 border-t border-[#e2d7c6] bg-[#fbf7ef] px-5 py-3 sm:px-7">
            <div className="min-w-0 flex-1">
              {error && <p role="alert" className="text-xs text-[#983f3d]">{error}</p>}
            </div>
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => move(step - 1)} disabled={saving} className="border-[#cdbfa9] bg-white">
                <ChevronLeft className="size-4" aria-hidden />返回
              </Button>
            )}
            <Button type="submit" disabled={saving || !stepReady} className="min-w-24 bg-[#3a2b17] text-[#fffaf0] hover:bg-[#4a371d]">
              {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : step === STEPS.length - 1 ? <Check className="size-4" aria-hidden /> : null}
              {saving ? "保存中" : step === STEPS.length - 1 ? "完成设置" : <>继续<ChevronRight className="size-4" aria-hidden /></>}
            </Button>
          </footer>
        </form>
      </motion.section>
    </main>
  );
}
