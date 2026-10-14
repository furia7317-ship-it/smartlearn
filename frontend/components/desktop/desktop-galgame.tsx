"use client";

import Image from "next/image";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Check,
  ChevronRight,
  Drama,
  Film,
  History,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Save,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import {
  GALGAME_BACKDROP_ASSETS,
  GALGAME_COMPANION_POSE_ASSETS,
  createGalgameVideo,
  galgameVideoUrl,
  generateGalgameProject,
  getGalgameVideoSnapshot,
  readGalgameProgress,
  readGalgameProjects,
  resourceDataToTheaterText,
  saveGalgameProgress,
  saveGalgameProject,
  selectGalgameBackdrop,
  selectGalgameCompanionPose,
  synthesizeGalgameLine,
  uploadGalgameDocument,
  type GalgameChoice,
  type GalgameProgress,
  type GalgameProject,
  type GalgameVideoSnapshot,
} from "@/lib/galgame";
import {
  addLearningActivityDuration,
  addLearningActivityInteraction,
  createLearningActivityEvent,
  finishLearningActivityEvent,
  LEARNING_ACTIVITY_UPDATED_EVENT,
  persistLearningActivityEvent,
  type LearningActivityEvent,
} from "@/lib/learning-activity";
import { getMaterialData, listMaterials, type StoredMaterial } from "@/lib/library";
import { getStudentId } from "@/lib/student-identity";
import type { ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

import styles from "./desktop-galgame.module.css";

const SUPPORTED_DOCUMENTS = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv";

function mergeApprovedResources(
  stored: StoredMaterial[],
  sessionResources: ResourceItem[],
): ResourceItem[] {
  const seen = new Set<string>();
  return [...stored, ...sessionResources].filter((resource) => {
    if (resource.status !== "ready" || seen.has(resource.id)) return false;
    seen.add(resource.id);
    return true;
  });
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function snapshotLabel(snapshot: GalgameVideoSnapshot | null): string {
  if (!snapshot) return "生成视频讲解";
  if (snapshot.status === "completed") return "播放视频讲解";
  if (snapshot.status === "failed") return "重新生成视频";
  return `视频生成中 ${Math.round(Math.max(0, Math.min(1, snapshot.progress)) * 100)}%`;
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export default function DesktopGalgame() {
  const session = useOrchestratorContext((state) => ({
    resources: state.resources,
    mode: state.mode,
  }));
  const reducedMotion = useReducedMotion();
  const [studentId, setStudentId] = useState("");
  const [library, setLibrary] = useState<StoredMaterial[]>([]);
  const [savedProjects, setSavedProjects] = useState<GalgameProject[]>([]);
  const [project, setProject] = useState<GalgameProject | null>(null);
  const [currentSceneId, setCurrentSceneId] = useState("");
  const [visitedSceneIds, setVisitedSceneIds] = useState<string[]>([]);
  const [choiceHistory, setChoiceHistory] = useState<GalgameProgress["choiceHistory"]>([]);
  const [displayedText, setDisplayedText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [generatingId, setGeneratingId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceProvider, setVoiceProvider] = useState("");
  const [videoTaskId, setVideoTaskId] = useState("");
  const [videoSnapshot, setVideoSnapshot] = useState<GalgameVideoSnapshot | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activityRef = useRef<LearningActivityEvent | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const approvedResources = useMemo(
    () => mergeApprovedResources(library, session.resources),
    [library, session.resources],
  );
  const currentScene = useMemo(
    () => project?.scenes.find((scene) => scene.id === currentSceneId) ?? project?.scenes[0] ?? null,
    [currentSceneId, project],
  );
  const currentIndex = project && currentScene
    ? project.scenes.findIndex((scene) => scene.id === currentScene.id)
    : -1;
  const isFinalScene = Boolean(project && currentIndex === project.scenes.length - 1);
  const companionPose = project && currentScene && currentIndex >= 0
    ? selectGalgameCompanionPose(currentScene, currentIndex, project.scenes.length)
    : "pointing";
  const sceneBackdrop = project && currentScene && currentIndex >= 0
    ? selectGalgameBackdrop(currentScene, currentIndex, project.scenes.length)
    : "courtyard";
  const sceneSources = useMemo(() => {
    if (!project || !currentScene) return [];
    const ids = new Set(currentScene.source_ids);
    return project.sources.filter((source) => ids.has(source.id));
  }, [currentScene, project]);
  const historyScenes = useMemo(() => {
    if (!project) return [];
    return visitedSceneIds
      .map((id) => project.scenes.find((scene) => scene.id === id))
      .filter((scene): scene is NonNullable<typeof scene> => Boolean(scene));
  }, [project, visitedSceneIds]);

  const openProject = useCallback((nextProject: GalgameProject, learnerId: string) => {
    const progress = readGalgameProgress(window.localStorage, learnerId, nextProject.id);
    const firstSceneId = nextProject.scenes[0]?.id ?? "";
    const restoredSceneId = nextProject.scenes.some((scene) => scene.id === progress?.sceneId)
      ? progress?.sceneId ?? firstSceneId
      : firstSceneId;
    setProject(nextProject);
    setCurrentSceneId(restoredSceneId);
    setVisitedSceneIds(progress?.visitedSceneIds.length ? progress.visitedSceneIds : [restoredSceneId]);
    setChoiceHistory(progress?.choiceHistory ?? []);
    setVideoTaskId(progress?.videoTaskId ?? "");
    setVideoSnapshot(null);
    setFeedback("");
    setError("");
  }, []);

  useEffect(() => {
    if (session.mode === "checking") return;
    let cancelled = false;
    const learnerId = getStudentId();
    setStudentId(learnerId);
    setSavedProjects(readGalgameProjects(window.localStorage, learnerId));
    listMaterials(session.mode)
      .then((items) => {
        if (cancelled) return;
        setLibrary(items);
        const requestedId = new URLSearchParams(window.location.search).get("resource");
        if (requestedId) setGeneratingId(`prefill:${requestedId}`);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "资料列表加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [session.mode]);

  const generateFromResource = useCallback(async (resource: ResourceItem) => {
    if (!studentId || generatingId || uploading) return;
    setGeneratingId(resource.id);
    setError("");
    try {
      const data = resource.data ?? await withDeadline(
        getMaterialData(session.mode, resource.id),
        20_000,
        "学习服务未及时返回资料正文，请恢复服务后重试",
      );
      const hydrated = { ...resource, data };
      const sourceText = resourceDataToTheaterText(hydrated);
      if (sourceText.length < 20) throw new Error("这份资料没有足够的可讲解文本");
      const nextProject = await generateGalgameProject({
        studentId,
        sourceTitle: resource.title,
        sourceText,
        sourceKind: "approved-resource",
        resourceId: resource.id,
        resourceType: resource.type,
      });
      setSavedProjects(saveGalgameProject(window.localStorage, studentId, nextProject));
      openProject(nextProject, studentId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "资料剧场生成失败");
    } finally {
      setGeneratingId("");
    }
  }, [generatingId, openProject, session.mode, studentId, uploading]);

  useEffect(() => {
    if (!generatingId.startsWith("prefill:") || approvedResources.length === 0 || !studentId) return;
    const requestedId = generatingId.slice("prefill:".length);
    const target = approvedResources.find((resource) => resource.id === requestedId);
    setGeneratingId("");
    if (target) void generateFromResource(target);
  }, [approvedResources, generateFromResource, generatingId, studentId]);

  const handleDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !studentId || uploading || generatingId) return;
    setUploading(true);
    setError("");
    try {
      const attachment = await uploadGalgameDocument(file);
      const nextProject = await generateGalgameProject({
        studentId,
        sourceTitle: attachment.name || file.name,
        sourceText: attachment.text,
        sourceKind: "uploaded-document",
        resourceId: attachment.id,
      });
      setSavedProjects(saveGalgameProject(window.localStorage, studentId, nextProject));
      openProject(nextProject, studentId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "文档导入失败");
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!currentScene) return;
    setDisplayedText("");
    setFeedback("");
    if (reducedMotion) {
      setDisplayedText(currentScene.text);
      return;
    }
    let index = 0;
    const step = Math.max(1, Math.ceil(currentScene.text.length / 140));
    const timer = window.setInterval(() => {
      index = Math.min(currentScene.text.length, index + step);
      setDisplayedText(currentScene.text.slice(0, index));
      if (index >= currentScene.text.length) window.clearInterval(timer);
    }, 28);
    return () => window.clearInterval(timer);
  }, [currentScene, reducedMotion]);

  useEffect(() => {
    if (!project || !currentSceneId || !studentId) return;
    setVisitedSceneIds((current) => current.at(-1) === currentSceneId
      ? current
      : [...current, currentSceneId].slice(-80));
  }, [currentSceneId, project, studentId]);

  useEffect(() => {
    if (!project || !currentSceneId || !studentId) return;
    saveGalgameProgress(window.localStorage, studentId, {
      projectId: project.id,
      sceneId: currentSceneId,
      visitedSceneIds,
      choiceHistory,
      ...(videoTaskId ? { videoTaskId } : {}),
      updatedAt: new Date().toISOString(),
    });
  }, [choiceHistory, currentSceneId, project, studentId, videoTaskId, visitedSceneIds]);

  useEffect(() => {
    if (!project || !studentId) return;
    const knowledgePoints = project.key_takeaways.slice(0, 12);
    activityRef.current = persistLearningActivityEvent(window.localStorage, createLearningActivityEvent({
      learnerId: studentId,
      resourceId: `theater:${project.id}`,
      resourceTitle: project.title,
      resourceType: "interactive",
      topic: project.source_title,
      knowledgePoints,
    }));
    const interval = window.setInterval(() => {
      if (!activityRef.current || document.visibilityState !== "visible") return;
      activityRef.current = persistLearningActivityEvent(
        window.localStorage,
        addLearningActivityDuration(activityRef.current, 10),
      );
      window.dispatchEvent(new Event(LEARNING_ACTIVITY_UPDATED_EVENT));
    }, 10_000);
    return () => {
      window.clearInterval(interval);
      if (activityRef.current) {
        persistLearningActivityEvent(window.localStorage, finishLearningActivityEvent(activityRef.current));
        window.dispatchEvent(new Event(LEARNING_ACTIVITY_UPDATED_EVENT));
        activityRef.current = null;
      }
    };
  }, [project, studentId]);

  useEffect(() => {
    const previousAudio = audioRef.current;
    if (previousAudio) {
      previousAudio.pause();
      URL.revokeObjectURL(previousAudio.src);
      audioRef.current = null;
    }
    if (!voiceEnabled || !currentScene) return;
    let cancelled = false;
    setVoiceLoading(true);
    synthesizeGalgameLine(currentScene.text)
      .then(({ url, provider }) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        const audio = new Audio(url);
        audioRef.current = audio;
        setVoiceProvider(provider);
        void audio.play().catch(() => setError("浏览器阻止了自动播放，请再次点击语音按钮"));
      })
      .catch((nextError) => {
        if (!cancelled) {
          setVoiceEnabled(false);
          setError(nextError instanceof Error ? nextError.message : "语音讲解暂不可用");
        }
      })
      .finally(() => {
        if (!cancelled) setVoiceLoading(false);
      });
    return () => {
      cancelled = true;
      const currentAudio = audioRef.current;
      if (currentAudio) {
        currentAudio.pause();
        URL.revokeObjectURL(currentAudio.src);
        audioRef.current = null;
      }
    };
  }, [currentScene, voiceEnabled]);

  useEffect(() => {
    if (!videoTaskId) return;
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const snapshot = await getGalgameVideoSnapshot(videoTaskId);
        if (cancelled) return;
        setVideoSnapshot(snapshot);
        if (snapshot.status !== "completed" && snapshot.status !== "failed") {
          timer = window.setTimeout(refresh, 3_000);
        }
      } catch (nextError) {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "视频状态读取失败");
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [videoTaskId]);

  const choose = (choice: GalgameChoice) => {
    if (!project || !currentScene) return;
    setChoiceHistory((items) => [...items, {
      sceneId: currentScene.id,
      choiceId: choice.id,
      label: choice.label,
    }]);
    if (activityRef.current) {
      activityRef.current = persistLearningActivityEvent(
        window.localStorage,
        addLearningActivityInteraction(activityRef.current, "selections"),
      );
    }
    setFeedback(choice.feedback);
    window.setTimeout(() => {
      const next = project.scenes.find((scene) => scene.id === choice.next_scene_id);
      if (next && next.id !== currentScene.id) {
        setCurrentSceneId(next.id);
      } else {
        setFeedback("");
      }
    }, choice.feedback ? 900 : 0);
  };

  const advance = () => {
    if (!project || currentIndex < 0) return;
    const next = project.scenes[currentIndex + 1];
    if (next) setCurrentSceneId(next.id);
  };

  const restart = () => {
    if (!project) return;
    setCurrentSceneId(project.scenes[0]?.id ?? "");
    setVisitedSceneIds(project.scenes[0] ? [project.scenes[0].id] : []);
    setChoiceHistory([]);
    setFeedback("");
  };

  const handleVideo = async () => {
    if (!project || !studentId) return;
    if (videoSnapshot?.status === "completed") {
      setVideoOpen(true);
      return;
    }
    setError("");
    try {
      const task = await createGalgameVideo(studentId, project);
      setVideoTaskId(task.task_id);
      setVideoSnapshot({ id: task.task_id, status: task.status, progress: 0 });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "视频任务创建失败");
    }
  };

  return (
    <div className={cn(styles.page, libraryCollapsed && styles.libraryCollapsed)}>
      <aside className={cn(styles.library, libraryCollapsed && styles.libraryIsCollapsed)} aria-label="互动教学片库">
        <button
          type="button"
          className={styles.libraryToggle}
          onClick={() => setLibraryCollapsed((value) => !value)}
          aria-label={libraryCollapsed ? "展开互动教学片库" : "收起互动教学片库"}
          title={libraryCollapsed ? "展开片库" : "收起片库"}
        >
          {libraryCollapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
        </button>

        {libraryCollapsed ? (
          <div className={styles.libraryCollapsedMark} aria-hidden>
            <Drama />
            <span>互动教学</span>
          </div>
        ) : <>
          <div className={styles.libraryHeading}>
            <div className={styles.eyebrow}><Drama aria-hidden /> 互动教学</div>
            <h1>让资料开口讲解</h1>
          </div>

          <button className={styles.uploadButton} onClick={() => fileRef.current?.click()} disabled={uploading || Boolean(generatingId)}>
            {uploading ? <Loader2 className={styles.spin} aria-hidden /> : <Upload aria-hidden />}
            {uploading ? "正在解析并编排" : "导入自己的文档"}
          </button>
          <input ref={fileRef} type="file" accept={SUPPORTED_DOCUMENTS} hidden onChange={handleDocument} />
          <p className={styles.fileHint}>支持 PDF、Word、PPT、表格与纯文本，单份不超过 20MB。</p>

          <div className={styles.sectionLabel}>已审核资料</div>
          <div className={styles.sourceList}>
            {approvedResources.length === 0 && <p className={styles.empty}>资源中心还没有可用资料。</p>}
            {approvedResources.map((resource) => (
              <button
                key={resource.id}
                className={cn(styles.sourceCard, project?.resource_id === resource.id && styles.activeCard)}
                disabled={Boolean(generatingId) || uploading}
                onClick={() => void generateFromResource(resource)}
              >
                <span className={styles.sourceIcon}><BookOpen aria-hidden /></span>
                <span className={styles.sourceCopy}>
                  <strong>{resource.title}</strong>
                  <small>{resource.meta.slice(0, 2).join(" · ") || "已通过资料审核"}</small>
                </span>
                {generatingId === resource.id ? <Loader2 className={styles.spin} aria-label="生成中" /> : <ChevronRight aria-hidden />}
              </button>
            ))}
          </div>

          {savedProjects.length > 0 && <>
            <div className={styles.sectionLabel}>我的互动教学存档</div>
            <div className={styles.saveList}>
              {savedProjects.map((item) => (
                <button key={item.id} onClick={() => openProject(item, studentId)}>
                  <Save aria-hidden />
                  <span><strong>{item.title}</strong><small>{formatCreatedAt(item.created_at)}</small></span>
                </button>
              ))}
            </div>
          </>}
        </>}
      </aside>

      <main className={styles.stageShell}>
        {error && (
          <div className={styles.errorBanner} role="alert">
            <span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误"><X aria-hidden /></button>
          </div>
        )}

        {!project || !currentScene ? (
          <section className={styles.welcome}>
            <div className={styles.welcomeSeal}><Drama aria-hidden /></div>
            <p className={styles.eyebrow}>SMARTLEARN INTERACTIVE LEARNING</p>
            <h2>把静态资料变成一场互动讲解</h2>
            <p>人物会围绕原文证据逐幕讲解，在关键处提问，并把你的选择与观看投入记录到学习画像。</p>
            <div className={styles.welcomeSteps}>
              <span><b>01</b> 选择或导入资料</span>
              <span><b>02</b> 自动拆分剧情与证据</span>
              <span><b>03</b> 互动、配音、生成视频</span>
            </div>
          </section>
        ) : (
          <section className={styles.stage} aria-label={`${project.title} 互动讲解`}>
            <div className={styles.stageTopbar}>
              <div>
                <span>{project.source_kind === "uploaded-document" ? "我的文档" : "已审核资料"}</span>
                <strong>{project.title}</strong>
              </div>
              <div className={styles.stageActions}>
                <button onClick={() => setHistoryOpen(true)}><History aria-hidden /> 回放</button>
                <button onClick={restart}><RotateCcw aria-hidden /> 重播</button>
                <button className={styles.videoButton} onClick={() => void handleVideo()} disabled={videoSnapshot?.status === "processing"}>
                  {videoSnapshot && !["completed", "failed"].includes(videoSnapshot.status)
                    ? <Loader2 className={styles.spin} aria-hidden />
                    : <Film aria-hidden />}
                  {snapshotLabel(videoSnapshot)}
                </button>
              </div>
            </div>

            <div className={styles.sceneCanvas}>
              <AnimatePresence mode="wait">
                <motion.div
                  className={styles.sceneBackdrop}
                  key={`${currentScene.id}:${sceneBackdrop}`}
                  initial={reducedMotion ? false : { opacity: 0, scale: 1.025 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reducedMotion ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.48, ease: "easeOut" }}
                  aria-hidden
                >
                  <Image
                    src={GALGAME_BACKDROP_ASSETS[sceneBackdrop]}
                    alt=""
                    fill
                    priority
                    sizes="(max-width: 1200px) 100vw, 1200px"
                  />
                </motion.div>
              </AnimatePresence>
              <div className={styles.inkMountains} aria-hidden />
              <AnimatePresence mode="wait">
                <motion.div
                  className={cn(styles.character, styles[`expression_${currentScene.expression}`])}
                  key={`${currentScene.id}:${companionPose}`}
                  initial={reducedMotion ? false : { opacity: 0, x: -18, scale: 0.985 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={reducedMotion ? undefined : { opacity: 0, x: 10, scale: 0.99 }}
                  transition={{ duration: 0.32, ease: "easeOut" }}
                >
                  <Image
                    src={GALGAME_COMPANION_POSE_ASSETS[companionPose]}
                    alt={`${project.companion_name}，资料剧场学习伙伴`}
                    fill
                    priority
                    sizes="(max-width: 1200px) 34vw, 390px"
                  />
                </motion.div>
              </AnimatePresence>

              <aside className={styles.blackboard} aria-label="本幕知识黑板">
                <div className={styles.boardTape} aria-hidden />
                <span className={styles.boardIndex}>{String(currentIndex + 1).padStart(2, "0")}</span>
                <h3>{currentScene.blackboard_title}</h3>
                <ul>
                  {currentScene.blackboard_points.map((point) => <li key={point}>{point}</li>)}
                </ul>
                {sceneSources.length > 0 && (
                  <div className={styles.citations}>
                    <span>讲解依据</span>
                    {sceneSources.map((source) => (
                      <details key={source.id}>
                        <summary>[{source.id}] {source.locator || source.title}</summary>
                        <p>{source.excerpt}</p>
                      </details>
                    ))}
                  </div>
                )}
              </aside>

              <div className={styles.progressRail} aria-label={`第 ${currentIndex + 1} 幕，共 ${project.scenes.length} 幕`}>
                {project.scenes.map((scene, index) => (
                  <span key={scene.id} className={cn(index <= currentIndex && styles.progressDone, index === currentIndex && styles.progressCurrent)} />
                ))}
              </div>

              <div className={styles.dialogue}>
                <div className={styles.speakerRow}>
                  <div><strong>{currentScene.speaker}</strong><span>{currentScene.title}</span></div>
                  <button
                    className={cn(styles.voiceButton, voiceEnabled && styles.voiceActive)}
                    onClick={() => setVoiceEnabled((value) => !value)}
                    aria-pressed={voiceEnabled}
                  >
                    {voiceLoading ? <Loader2 className={styles.spin} aria-hidden /> : voiceEnabled ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
                    {voiceEnabled ? `语音开启${voiceProvider ? ` · ${voiceProvider}` : ""}` : "开启语音"}
                  </button>
                </div>
                <p className={styles.dialogueText}>{displayedText}<span className={styles.cursor} aria-hidden /></p>
                <AnimatePresence mode="wait">
                  {feedback && (
                    <motion.p className={styles.feedback} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      <Check aria-hidden /> {feedback}
                    </motion.p>
                  )}
                </AnimatePresence>
                <div className={styles.choices}>
                  {currentScene.choices.length > 0 ? currentScene.choices.map((choice) => (
                    <button key={choice.id} onClick={() => choose(choice)} disabled={Boolean(feedback)}>
                      <span>{choice.label}</span><ChevronRight aria-hidden />
                    </button>
                  )) : isFinalScene ? (
                    <button onClick={restart}><RotateCcw aria-hidden /> 从头再看</button>
                  ) : (
                    <button onClick={advance}>继续下一幕 <ChevronRight aria-hidden /></button>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <AnimatePresence>
        {historyOpen && project && (
          <motion.div className={styles.drawerBackdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHistoryOpen(false)}>
            <motion.aside className={styles.historyDrawer} initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} onClick={(event) => event.stopPropagation()}>
              <header><div><span>会话回放</span><h2>{project.title}</h2></div><button onClick={() => setHistoryOpen(false)}><X aria-hidden /></button></header>
              <div className={styles.historyList}>
                {historyScenes.map((scene, index) => (
                  <button key={`${scene.id}-${index}`} onClick={() => { setCurrentSceneId(scene.id); setHistoryOpen(false); }}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{scene.title}</strong><p>{scene.text}</p></div>
                  </button>
                ))}
              </div>
              {choiceHistory.length > 0 && <footer><strong>你的选择</strong>{choiceHistory.map((choice, index) => <span key={`${choice.choiceId}-${index}`}>{choice.label}</span>)}</footer>}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {videoOpen && project && videoTaskId && (
          <motion.div className={styles.videoBackdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setVideoOpen(false)}>
            <motion.div className={styles.videoModal} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} onClick={(event) => event.stopPropagation()}>
              <header><div><Film aria-hidden /><span><strong>视频讲解</strong><small>{project.title}</small></span></div><button onClick={() => setVideoOpen(false)}><X aria-hidden /></button></header>
              <video controls autoPlay src={galgameVideoUrl(videoTaskId)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
