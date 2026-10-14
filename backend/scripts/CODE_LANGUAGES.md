# 实训编译运行

实训工作台支持 Python、Java、C 和 C++，每种语言单独保存代码与标准输入。Java 入口为 `Main.java` 中的 `Main.main`，C 使用 C17，C++ 使用 C++17。现有任务的函数接口、自测与逐步轨迹仍使用 Python。

Python 使用项目自带的受限执行器；Java 需要 JDK。编译器按以下顺序查找：

1. 环境变量 `CODE_LAB_JAVAC`、`CODE_LAB_CC`、`CODE_LAB_CXX` 指定的可执行文件。
2. `frontend/runtime/toolchains/jdk/bin` 或 `frontend/runtime/toolchains/w64devkit/bin`。
3. Java 的 `JAVA_HOME/bin`，以及系统 `PATH`。

Windows 可用 PowerShell 7 执行 `backend/scripts/setup-code-toolchains.ps1` 安装项目私有的 C/C++ 工具链。脚本校验固定 SHA-256，需要本机 7-Zip。工具链目录被 Git 忽略，部署到其他机器时需另行安装或配置；Java 的 `java` 应与 `javac` 位于同一目录。

`POST /api/code-lab/execute` 需要登录，接受 `language`、`code`、`stdin`；`GET /api/code-lab/languages` 返回工具链可用状态。编译最长 15 秒，原生程序运行最长 3 秒，标准输出和错误输出各限制 16000 字节。Windows Job Object 限制进程数量、内存并清理子进程。

原生运行器用于本地桌面实训，不是隔离不可信代码的公共服务沙箱。
