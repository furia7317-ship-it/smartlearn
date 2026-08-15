// 最小 preload：前端不需要 Node 能力，仅暴露版本信息供"关于"展示。
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  studentId: process.env.SMARTLEARN_STUDENT_ID || "",
  apiBase: process.env.SMARTLEARN_API_BASE || "http://localhost:8000",
});
