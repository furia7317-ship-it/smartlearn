import type { LearningBaseline, LearningLevel } from "./learning-baseline.ts";
import type { AssessmentRecord } from "./library.ts";

export type GateStep = "start" | "self_report" | "diagnostic_loading" | "questions" | "submitting" | "error";
export interface GateState { step: GateStep; selectedLevel: LearningLevel | null; customDescription: string; selectedHistoryId: string | null; error: string; }
export const LEVEL_LABEL: Record<LearningLevel, string> = { novice:"小白", basic:"略懂", intermediate:"有一定基础", advanced:"比较熟练", custom:"其他/自定义" };
export const initialGateState = (): GateState => ({ step:"start", selectedLevel:null, customDescription:"", selectedHistoryId:null, error:"" });
export const enterSelfReport = (state: GateState): GateState => ({ ...state, step:"self_report", error:"" });
export const cancelGate = (): null => null;
export function normalizeScore(value: unknown): number { const valueNumber=Number(value)||0; return Math.max(0, Math.min(1, valueNumber>1 ? valueNumber/100 : valueNumber)); }
export function optionAnswerValue(option: string, index: number): string { const match=option.trim().match(/^([A-Da-d])(?:[.、:：\s]|$)/); return match ? match[1].toUpperCase() : String.fromCharCode(65 + index); }
export function selfReportBaseline(state: GateState): LearningBaseline | null { if (!state.selectedLevel || state.selectedLevel==="custom" && state.customDescription.trim().length<4) return null; return { source:"self_report",level:state.selectedLevel,confidence:.6,summary:`用户自评·${LEVEL_LABEL[state.selectedLevel]}`,custom_description:state.customDescription }; }
export function explicitDefault(): LearningBaseline { return { source:"explicit_default",level:"basic",confidence:.4,summary:"用户明确选择系统默认方案（略懂/basic、理论与实践均衡）",explicit_default_confirmed:true }; }
export function diagnosticBaseline(overall: unknown, mastery: Record<string, unknown>, count: number): LearningBaseline { const score=normalizeScore(overall); const level:LearningLevel=score<.4?"novice":score<.65?"basic":score<.8?"intermediate":"advanced"; const entries=Object.entries(mastery).map(([key,value])=>[key,normalizeScore(typeof value==="object"&&value?(value as {score?:unknown}).score:value)] as const); return {source:"diagnostic",level,confidence:Math.min(.95,Math.max(.55,count/12)),summary:`客观摸底得分 ${Math.round(score*100)}%`,strengths:entries.filter(([,v])=>v>=.7).map(([k])=>k),gaps:entries.filter(([,v])=>v<.6).map(([k])=>k),mastery}; }
export function historyBaseline(record: AssessmentRecord): LearningBaseline { const level:LearningLevel=record.self_level.includes("完全")?"advanced":record.self_level.includes("进阶")?"intermediate":record.self_level.includes("基础")?"novice":"basic"; return {source:"existing_profile",level,confidence:.7,summary:record.analysis.summary??record.analysis.narrative??`历史摸底：${record.subject}`,strengths:record.analysis.strengths??[],gaps:record.analysis.gaps??[],mastery:record.analysis.knowledge_seed??{}}; }
