# dnSpy Linux 支持技术方案（Electron + React）

> 状态：已实现（Linux 1.0.0）
>
> 基线：`master`，提交 `1f920a801`
>
> 目标平台：Linux 桌面；新前端本身保持 Windows、macOS 可构建能力

实现位于 `CrossPlatform/`，用户安装与调试权限说明见 `docs/linux-user-guide.md`。稳定版验证入口：

```bash
cd CrossPlatform
./scripts/install-netcoredbg.sh
dotnet test dnSpy.CrossPlatform.slnx -m:1 -p:UseSharedCompilation=false --configuration Release
pnpm --dir frontend test
pnpm --dir frontend build
pnpm --dir frontend test:e2e
pnpm package:linux
```

## 1. 结论摘要

本方案不尝试让 WPF 运行在 Linux，也不在现有项目中大量加入条件编译。建议保留当前 Windows/WPF 应用，在仓库中新增一条跨平台产品线：

- 前端使用 Electron、React 和 TypeScript，负责窗口、菜单、工具栏、停靠布局、编辑器、快捷键和所有用户交互。
- 后端使用无 UI 依赖的 .NET 10 进程，负责程序集模型、反编译、搜索、分析、编辑、保存和调试会话。
- Electron 主进程启动并监管后端，通过基于标准输入/输出的 JSON-RPC 通信；渲染进程只能通过受限的 preload API 调用主进程。
- Linux 调试 .NET/CoreCLR 程序时，通过调试适配层连接 `netcoredbg`；Mono/Unity 调试作为后续阶段接入 `Mono.Debugger.Soft`。
- React 界面以当前上游 WPF 版本为布局和交互基准，保留“顶部菜单及工具栏、左侧程序集树、中央文档标签、四向工具窗口、底部状态栏”的结构，并复用现有主题语义和图标资源。
- 采用增量替换策略：先交付只读查看和反编译，再交付编辑，最后完成 Linux 调试能力。Windows/WPF 版本在迁移期间继续构建和发布。

这不是一次单纯的 UI 改写。当前项目的主程序、契约层、反编译适配层、调试器和扩展均存在 WPF 或 Windows API 依赖，因此必须先建立真正无 UI 的应用核心和稳定的进程协议，再构建 React 前端。

## 2. 当前状态与约束

### 2.1 仓库现状

截至上述基线提交，仓库具有以下明确约束：

- `DnSpyCommon.props` 的目标框架为 `net48;net10.0-windows`，运行时标识仅有 `win-x86;win-x64`。
- `dnSpy/dnSpy/dnSpy.csproj` 使用 `Microsoft.NET.Sdk.WindowsDesktop`，同时启用 WPF 和 Windows Forms。
- `dnSpy.Contracts.DnSpy`、`dnSpy.Decompiler`、Roslyn 编辑器适配层及主要扩展也直接依赖 WPF。
- 主窗口、工具窗口、标签、命令路由、主题和编辑器大量使用 `System.Windows`、XAML、WPF 命令和控件类型。
- CorDebug 实现属于 Windows 技术栈，不能作为 Linux 调试器直接复用。
- `dnSpy.Console` 虽然是命令行程序，当前仍使用 Windows Desktop SDK，并链接了带 Windows 依赖的代码。
- 仓库中的 `Linux/` 当前没有受 Git 跟踪的源文件；其中本地可见内容均为被忽略的 `bin/`、`obj/` 等构建产物，不能视为已有实现或迁移基础。

### 2.2 可复用与不可直接复用的部分

可优先复用：

- dnlib 的程序集读取、元数据修改和写回能力。
- ILSpy 反编译引擎中不依赖 UI 的部分。
- Roslyn 编译器和语言服务中不依赖 `Workspaces.Desktop`/WPF 的部分。
- PE、元数据、反汇编、搜索和分析算法中只依赖 BCL 的代码。
- Mono 调试协议层中不依赖 UI 的部分。
- 现有主题定义、资源字符串、命令名称、图标和默认窗口布局，作为新前端的行为基准。

不能直接复用：

- XAML 视图、WPF 控件、`DependencyObject`、`RoutedCommand`、`ICommand` 绑定和 WPF Dispatcher 代码。
- 对象模型中公开 `Brush`、`ImageSource`、`FrameworkElement`、`UIElement` 等 UI 类型的契约。
- AvalonEdit、ICSharpCode WPF TreeView 及 WPF Dock/Tab 实现。
- Windows 文件对话框、注册表、管理员提权、COM、Win32 窗口句柄和 Windows 剪贴板集成。
- 基于 CorDebug 的 Windows 调试实现及只在 Windows 存在的反调试绕过能力。
- 现有包含 WPF UI 导出的 MEF 扩展二进制文件。

## 3. 支持范围

### 3.1 首个稳定版目标

首个 Linux 稳定版应覆盖 dnSpy 的核心工作流：

1. 打开一个或多个 .NET 程序集、目录和依赖项。
2. 延迟加载程序集树，查看类型、成员、资源和元数据。
3. 反编译 C#、Visual Basic、IL，并支持引用跳转、历史和多标签。
4. 搜索类型、成员、字符串和元数据；提供基本引用分析。
5. 查看 PE、元数据及十六进制内容。
6. 编辑方法、IL、资源和常见元数据，并以“另存为”为默认保存策略。
7. 启动或附加 Linux 上的 .NET/CoreCLR 进程，支持断点、继续、单步、线程、调用栈、局部变量、监视和模块视图。
8. 支持浅色、深色、蓝色和高对比主题，保存布局、最近文件和用户设置。
9. 提供 AppImage 和 `.deb` 安装包；RPM 和 `tar.gz` 可作为同阶段或紧随其后的产物。

### 3.2 明确的能力边界

| 能力 | Linux 首个稳定版 | 后续方向 |
| --- | --- | --- |
| .NET/CoreCLR 程序集查看和反编译 | 支持 | 持续对齐上游 |
| dnlib 程序集及 IL 编辑 | 支持 | 扩大编辑器覆盖面 |
| .NET/CoreCLR 启动与附加调试 | 支持 | 扩充热重载、转储等能力 |
| Mono/Unity 软调试 | Beta 或次版本 | 完整支持启动、连接和 Unity 场景 |
| .NET Framework 运行时调试 | 不支持 | Linux 上仅可通过 Mono 场景评估 |
| Windows CorDebug 特性 | 不支持 | Electron Windows 版可单独接入 Windows Provider |
| BAML 反编译 | 支持不依赖 WPF 运行时的解析 | 不承诺 Linux 上进行 WPF 设计预览 |
| C#/VB 交互窗口 | 次版本 | 独立子进程隔离执行环境 |
| 现有 WPF/MEF 扩展二进制兼容 | 不支持 | 提供新的前后端扩展协议 |
| Windows 专属反调试绕过 | 不支持 | 不纳入 Linux 对等性指标 |

“支持 Linux”不应被定义为所有 Windows 特性逐项照搬。平台本身不存在或底层调试器不提供的能力，应在 UI 中通过 capability 明确禁用并说明原因，不能显示一个最终必然失败的命令。

### 3.3 平台基线

- 必测平台：Ubuntu 24.04 LTS x64，X11 和 Wayland 会话。
- 兼容平台：Debian 13 x64、当前受支持 Fedora x64，纳入打包冒烟测试。
- Linux arm64：架构设计和 CI 从开始即避免阻塞，但正式交付取决于调试引擎及所有原生依赖的 arm64 可用性。
- 文件系统：同时测试大小写敏感路径、符号链接、无执行权限目录、只读目录和包含非 ASCII 字符的路径。

## 4. 总体架构

```text
+---------------- Electron application ----------------+
|                                                       |
|  React renderer                                       |
|  - Shell / dock layout / views / editors              |
|  - no Node.js, filesystem or process access           |
|                 | typed window.dnSpy API              |
|  sandboxed      v                                     |
|  preload bridge ---- Electron main process            |
|                     - window/menu/dialog lifecycle    |
|                     - backend process supervision     |
+------------------------------|------------------------+
                               | framed JSON-RPC over stdio
                               v
+---------------- Cross-platform .NET backend ----------+
| RPC Host -> Application services -> Domain/Core       |
|                 |                    |                 |
|                 |                    +-- dnlib         |
|                 |                    +-- decompiler    |
|                 |                    +-- Roslyn core   |
|                 |                                      |
|                 +-- platform services                  |
|                 +-- debug adapter abstraction ---------+--> netcoredbg/DAP
+--------------------------------------------------------+
```

架构边界遵循以下规则：

- React 组件不持有 dnlib、调试器或文件句柄；它只持有可序列化的视图模型和后端对象 ID。
- .NET 后端不得引用 Electron、浏览器、WPF、Windows Forms 或任意 UI 类型。
- Electron 主进程只处理桌面集成与进程生命周期，不实现反编译、编辑或调试业务。
- OS 差异集中在少量平台服务和调试 Provider 中，领域逻辑不使用散落的 `OperatingSystem.IsLinux()` 分支。
- 所有长操作可取消、可报告进度；大对象按页或按范围加载，避免一次通过 IPC 传送完整程序集模型。

## 5. 建议目录结构

建议新增 `CrossPlatform/`，避免用 `Linux/` 命名一套实际可以跨平台构建的 Electron 产品，也避免改动现有 Windows 目录的含义：

```text
CrossPlatform/
  backend/
    dnSpy.Backend.Contracts/       # DTO、错误码、capability，不引用实现
    dnSpy.Backend.Core/            # 程序集、反编译、编辑等领域模型
    dnSpy.Backend.Application/     # 用例、会话、命令与查询
    dnSpy.Backend.Infrastructure/  # 文件、进程、配置、缓存、符号
    dnSpy.Backend.Debugging/       # 调试抽象与通用模型
    dnSpy.Backend.Debugging.Dap/   # netcoredbg DAP Provider
    dnSpy.Backend.Host/            # JSON-RPC、DI、日志、进程入口
    tests/
  frontend/
    electron/                      # main 与 preload
    src/
      app/                         # 应用壳、路由、store、命令注册
      components/                  # 通用控件
      features/                    # explorer、documents、search、debug 等
      layout/                      # dock 模型与默认布局
      themes/                      # CSS 语义 token
    tests/
    package.json
  protocol/
    methods.json                   # 方法、事件、版本和权限声明
    schemas/                       # JSON Schema DTO
    generated/                     # 构建时生成，不手工编辑
  packaging/
    linux/
  scripts/
  pnpm-workspace.yaml
  README.md
```

新建独立解决方案 `CrossPlatform/dnSpy.CrossPlatform.sln`。在依赖清理完成前，不把所有现有 Windows 项目加入这个解决方案；这可确保 Linux CI 不会因为还未迁移的 WPF 项目而失败。顶层 CI 再分别调用原 Windows 解决方案和跨平台解决方案。

## 6. 前端方案

### 6.1 技术选型

- Electron：桌面窗口、系统菜单、文件对话框、进程监管和安装包。
- React + TypeScript：视图和交互实现，开启 TypeScript 严格模式。
- Vite：渲染进程及开发构建。
- `flexlayout-react`：中央文档组和四向工具窗口的停靠、拆分、标签与布局序列化。实施前用一周内的 PoC 验证键盘导航、最小尺寸、拖放和高 DPI；若达不到要求，保持相同的布局模型后替换实现。
- Monaco Editor：反编译代码、IL、搜索结果预览和编辑器。导航、分类着色、悬停及诊断信息由后端提供，Monaco 只负责展示和输入。
- Redux Toolkit：集中保存工作区、文档、调试状态和持久化布局；短暂的组件 UI 状态保留在组件内部。
- Vitest + React Testing Library：组件和状态测试。
- Playwright Electron：端到端和视觉回归测试。

所有版本通过 lockfile 固定。Electron 大版本升级单独提交，并执行完整的 IPC、安全和打包回归测试。

### 6.2 Electron 安全边界

BrowserWindow 必须使用以下基线：

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- preload 只通过 `contextBridge` 暴露白名单方法，不能暴露通用 `send(channel, payload)`。
- 使用严格 CSP，不加载远程脚本，不允许任意 `eval`。
- 阻止非白名单导航、弹窗、下载和外部协议；打开外部 URL 前进行协议校验并要求明确用户动作。
- 渲染进程不能直接获得后端 stdio、任意文件路径读取能力或 `child_process`。
- 打包时启用 Electron fuses，禁用不需要的运行时能力，并把后端二进制放在只读 resources 目录而非 ASAR 内。

文件打开流程为：React 请求 `dialog.openAssemblies()`，preload 调用主进程，主进程显示原生对话框并把用户选中的路径交给后端。拖放文件也必须走相同的路径规范化和工作区打开命令。

### 6.3 与上游一致的默认布局

上游布局以 `MainWindow.xaml`、`MainWindowControl.cs`、`AppToolBar.cs`、`AppStatusBar.cs` 和 `Themes/*.dntheme` 为事实来源，不凭截图重新猜测结构。

默认窗口保留上游的 `1000 x 600` 初始尺寸和以下区域：

```text
+------------------------------------------------------------------+
| title / menu                                                      |
+------------------------------------------------------------------+
| command toolbar                                                   |
+------------------+-----------------------------------------------+
| Assembly Explorer| document tab group(s)                         |
| default width 250| C# / VB / IL / hex / metadata                 |
|                  |                                               |
+------------------+-----------------------------------------------+
| optional left/right/top/bottom docked tool windows               |
| bottom default height 250: Output / Locals / Watch / ...         |
+------------------------------------------------------------------+
| status bar                                                        |
+------------------------------------------------------------------+
```

布局一致性具体定义为：

- 菜单分组、主要工具栏命令、快捷键及命令启用条件与上游一致。
- 程序集树默认位于左侧，文档区位于中央，输出和调试窗口默认位于底部。
- 工具窗口可移动到左、右、上、下，文档可以拆分为多个标签组；尺寸和最后激活项可持久化。
- 默认宽度、默认高度、最小尺寸、标签排序和关闭行为以现有 WPF 常量为基线。
- 浅色、深色、蓝色和高对比主题使用相同的语义色角色，而不是只做近似的单色皮肤。
- Linux 字体渲染、原生标题栏和系统菜单差异不计为功能不一致；布局区域、命令和工作流差异计入。

建立“上游 WPF 参考截图 + Electron 对应截图”的视觉基线，至少覆盖 `1000 x 600`、`1440 x 900` 和 200% 缩放。视觉回归自动检测后仍需人工检查文字截断、焦点、拖放目标、滚动和高对比可读性，不仅依赖像素阈值。

### 6.4 UI 模块映射

| 上游模块 | React 实现 | 数据来源 |
| --- | --- | --- |
| MainWindow/AppWindow | `AppShell` | Electron window state |
| Menu/Toolbar commands | `CommandRegistry`、`MenuBar`、`ToolBar` | capability + selection context |
| DocumentTreeView | `AssemblyExplorer` 虚拟树 | `workspace/tree/*` |
| Tab/TabGroup | `DocumentDock` | 前端布局状态 |
| Code editor/AvalonEdit | `CodeDocument`/Monaco | `document/decompile` |
| Hex editor | `HexDocument` 虚拟分页视图 | `hex/readRange` |
| Searcher | `SearchToolWindow` | 流式搜索事件 |
| Analyzer | `AnalyzerToolWindow` | 分页引用图查询 |
| Output | `OutputToolWindow` | 日志和任务事件 |
| Debug tool windows | `Locals`、`Watch`、`CallStack` 等 | 调试会话事件 |
| Status bar | `StatusBar` | 任务、位置、缩放和调试状态 |

### 6.5 命令系统

建立与 React 组件解耦的命令注册表。每个命令包含稳定 ID、标题资源键、图标、默认快捷键、`isVisible`、`isEnabled` 和执行函数。菜单、工具栏、上下文菜单和快捷键共享同一条命令定义，避免四处复制状态判断。

后端在握手和会话变化时发布 capability，例如：

```json
{
  "debug.coreclr.launch": true,
  "debug.coreclr.attach": true,
  "debug.mono.connect": false,
  "assembly.edit": true,
  "baml.preview": false
}
```

前端基于 capability 和当前选择决定命令状态。未知 capability 默认关闭，以便前端和后端版本短暂不一致时安全降级。

### 6.6 主题、图标与本地化

- 把 `*.dntheme` 中的颜色角色映射为 CSS 自定义属性，例如编辑器背景、树选中项、停靠边框、菜单悬停、诊断级别和调试当前行。
- 写一个确定性的资源转换工具，从现有图标源生成前端可用的 SVG/PNG 清单；记录来源和许可证。缺失图标优先使用现有图标语义，通用操作再使用统一图标库。
- Monaco 主题由同一份语义 token 生成，避免编辑器和外壳出现两套主题。
- 初期导入上游英语资源并保留资源键；React 使用 i18n 资源文件。后端错误只返回稳定错误码和参数，面向用户的文案在前端本地化。
- RTL、长德语文本、中文路径和 125%/150%/200% 缩放纳入组件测试。

## 7. 后端跨平台改造

### 7.1 分层原则

后端采用四层结构：

1. `Contracts`：纯 DTO、枚举、对象 ID、错误码和 capability。
2. `Core`：程序集、符号、反编译、编辑事务等领域能力。
3. `Application`：打开工作区、生成文档、搜索、保存、启动调试等用例。
4. `Infrastructure/Host`：文件系统、进程、运行时发现、JSON-RPC、日志和具体调试 Provider。

`Core` 和 `Contracts` 必须构建为 `net10.0`，不得使用 `-windows` TFM，不得启用 WPF/Windows Forms。使用架构测试在 CI 中禁止引用以下程序集或命名空间：

- `PresentationFramework`
- `PresentationCore`
- `WindowsBase` 中的 UI 类型
- `System.Windows.Forms`
- `Microsoft.Win32.Registry`（平台实现项目除外）

不要为了“复用”而直接引用当前 `dnSpy.Contracts.DnSpy`。其中许多契约公开 WPF 类型，会把 UI 依赖重新带入后端。应从具体用例出发迁移纯逻辑，并用无 UI DTO 替换视图对象。

### 7.2 代码迁移顺序

1. 生成依赖清单：对现有项目和类型标记 `portable`、`portable-after-refactor`、`windows-only`、`ui-only`。
2. 先迁移叶子能力：程序集读取、语言列表、反编译设置、文本输出、元数据查询。
3. 再迁移组合能力：工作区、文档导航、搜索、分析、十六进制读取。
4. 将修改操作建模为事务和命令，不把 WPF ViewModel 移到后端。
5. 最后接入调试器、表达式求值、符号和复杂编辑能力。

优先移动或链接真正平台无关的现有代码；只有当现有类型把 UI 和业务不可分割地混在一起时才重写。任何移出的共享代码同时由 Windows 回归测试覆盖，防止形成两套行为不同的实现。

### 7.3 程序集、反编译与导航

- 使用 dnlib 作为可编辑程序集模型的主要实现。
- 直接引用 ILSpy 的无 UI 反编译引擎，不引用当前带 WPF 依赖的 `dnSpy.Decompiler` 外壳。
- 用适配器保留 dnSpy 的语言选择、格式化选项、token/地址映射和导航语义。
- 后端为每个工作区、模块、树节点和文档分配会话范围内的不可猜测 ID；前端不持有后端对象指针的序列化形式。
- 树节点按需加载，响应只返回当前层和 `hasChildren`。大型程序集不得在打开时构造整棵 JSON 树。
- 反编译结果包含文本以及稀疏的 span 数据：定义、引用、元数据 token、IL offset、诊断和可编辑范围。
- 关闭工作区时统一释放模块、PDB、内存映射、缓存和文件监听器。

### 7.4 编辑与保存

编辑必须采用显式事务：

1. `edit/begin` 创建基于模块版本的事务。
2. 一个或多个 edit command 修改事务副本。
3. `edit/validate` 返回诊断和预览差异。
4. `edit/commit` 更新内存工作区版本。
5. `module/saveAs` 原子写入新文件并重新打开校验。

默认使用“另存为”，不覆盖原始程序集。用户明确选择覆盖时，先写同目录临时文件、刷新并校验，然后原子替换；平台不支持原子替换或权限不足时必须失败并保留原文件。是否创建备份作为设置项，但不能把备份当成原子写入的替代品。

每个修改命令携带基础版本号。版本已变化时返回冲突，而不是静默覆盖另一个标签或操作产生的修改。

### 7.5 平台服务

只抽象确实存在平台差异的边界，不对 `System.IO` 做无意义的全量包装。建议接口包括：

- `IPlatformPaths`：配置、缓存、日志和临时目录。Linux 遵循 XDG Base Directory。
- `IRuntimeLocator`：发现 dotnet、Mono、目标进程运行时和调试器。
- `IProcessService`：启动、附加检查、环境变量和退出监管。
- `IDebugProvider`：按 capability 创建调试会话。
- `ISymbolLocator`：本地及可选符号服务器查找。
- `IPlatformIntegration`：打开外部目录、文件关联等非核心桌面能力。

Linux 特别处理：

- 路径比较默认区分大小写，不复用 Windows 的不区分大小写 comparer。
- 正确处理符号链接、`/proc/<pid>`、没有扩展名的可执行文件和 ELF apphost。
- 配置写入 `$XDG_CONFIG_HOME/dnspy`，缓存写入 `$XDG_CACHE_HOME/dnspy`；变量为空时使用规范 fallback。
- 不自动执行 `sudo`，不自动修改 `/proc/sys/kernel/yama/ptrace_scope`。附加权限失败时显示可操作的诊断信息。
- 所有进程参数使用结构化 argument list，不拼接 shell 命令。

## 8. 前后端协议

### 8.1 传输方式

Electron 主进程以子进程方式启动 `dnSpy.Backend.Host`，使用类似 LSP 的 `Content-Length` framing 在 stdin/stdout 上传输 JSON-RPC 2.0。选择 stdio 的原因是：

- 不监听 TCP 端口，不引入端口冲突和本机网络攻击面。
- 生命周期天然从属于 Electron 主进程。
- Windows、Linux、macOS 行为一致，开发时也容易独立录制和重放。

stderr 专用于结构化日志，不能混入协议内容。启动参数包含父进程 PID、协议版本和一次性随机 nonce；后端在握手中回显 nonce，父进程退出后后端也应退出。主进程负责超时、崩溃检测和最多一次受控重启，不能进入无限重启循环。

### 8.2 契约与兼容性

- `protocol/methods.json` 定义方法名、方向、请求/响应 schema、是否可取消和所需 capability。
- `protocol/schemas` 是 DTO 的单一事实来源，构建时生成 C# 和 TypeScript 类型。
- CI 执行生成后 diff，确保提交的生成物没有漂移。
- 握手交换 `protocolVersion`、`backendVersion`、平台、架构和 capability。
- 同一主版本内只允许增加可选字段和新方法；删除字段或改变语义必须提升协议主版本。
- 所有请求带 request ID；工作区相关请求额外带 workspace ID。通知带单调递增的 session sequence，前端可以丢弃旧会话迟到的事件。

建议首批方法：

| 分组 | 方法示例 | 说明 |
| --- | --- | --- |
| 生命周期 | `system/hello`、`system/shutdown`、`system/cancel` | 版本、能力、取消 |
| 工作区 | `workspace/open`、`workspace/close`、`workspace/addAssembly` | 会话管理 |
| 树 | `tree/getRoots`、`tree/getChildren` | 延迟加载 |
| 文档 | `document/decompile`、`document/navigate` | 文本与 span |
| 搜索 | `search/start`、`search/result`、`search/complete` | 流式结果 |
| 十六进制 | `hex/getLength`、`hex/readRange` | 限长分页 |
| 编辑 | `edit/begin`、`edit/apply`、`edit/validate`、`edit/commit` | 事务编辑 |
| 保存 | `module/saveAs` | 原子写入和校验 |
| 调试 | `debug/launch`、`debug/attach`、`debug/command` | 会话控制 |
| 调试事件 | `debug/stopped`、`debug/continued`、`debug/terminated` | 异步状态 |

### 8.3 大数据和取消

- IPC 不传完整程序集字节；后端直接读取用户已选择的路径。
- 十六进制读取单次限制为固定范围，例如 1 MiB，并支持预取相邻页。
- 搜索、分析和输出使用批量事件，避免每个结果一条消息造成消息风暴。
- 反编译文本按文档返回；超大结果允许分页或临时只读流，阈值由压力测试确定。
- 每个耗时 RPC 接收 cancellation token。切换文档、关闭工作区或再次搜索时，前端立即取消旧请求。
- 响应使用稳定错误码，如 `FileNotFound`、`UnsupportedRuntime`、`EditConflict`、`DebugAttachDenied`；堆栈信息只写日志，不直接作为用户文案。

## 9. Linux 调试方案

### 9.1 调试抽象

在应用层定义统一调试模型，至少包含：

- `DebugSession`、`Process`、`Runtime`、`Thread`、`StackFrame`
- `Module`、`Breakpoint`、`ExceptionBreakpoint`
- `Scope`、`Variable`、`EvaluationResult`
- `StoppedReason`、`StepKind`、`DebugCapability`

Provider 将底层协议转换为该模型。React 前端只依赖统一模型，因此以后可以增加 Windows CorDebug、Mono 或其他 Provider，而不重写 Locals、Watch、Call Stack 等视图。

### 9.2 CoreCLR Provider

Linux 第一实现建议采用 `netcoredbg` 的 Debug Adapter Protocol 模式：

1. 后端启动并监管 `netcoredbg` 子进程。
2. `dnSpy.Backend.Debugging.Dap` 负责 DAP framing、请求关联、事件顺序和取消。
3. 将 DAP 的断点、线程、栈帧、scope、变量和 evaluate 映射到统一模型。
4. dnSpy 后端继续负责模块/源映射、反编译文档定位和无源码断点绑定。

正式采用前必须完成技术和许可证门禁：

- 固定已验证的 netcoredbg 版本和 SHA-256，不在运行时下载未知版本。
- 确认再分发许可证、第三方声明及 x64/arm64 二进制来源。
- 验证目标 .NET 运行时版本范围、Portable PDB、优化代码、单文件应用和 ReadyToRun 行为。
- 若不能合法或稳定地随包分发，改为启动时发现系统安装，并提供明确的安装说明；不能静默联网安装。

### 9.3 Mono/Unity Provider

现有 `Mono.Debugger.Soft` 可作为协议基础，但需先从 WPF 调试项目中提取无 UI 会话层。Mono/Unity Provider 在 capability 中分别声明 launch、connect、attach、evaluation 等能力。首个稳定版可以把它标为 Beta，但协议和 UI 不应假定只有 CoreCLR。

### 9.4 Linux 调试限制与错误处理

- 附加进程通常要求相同用户，并受 Yama/容器/SELinux 限制。
- Flatpak/Snap 沙箱可能限制 `/proc` 和 ptrace；首发包不以沙箱格式作为唯一分发方式。
- Windows PDB、混合模式调试、32 位目标以及某些优化后的表达式求值可能不完整，应由 Provider capability 精确报告。
- 调试器崩溃时，后端结束当前 session、保留工作区、输出诊断包位置，前端不得一起退出。
- 自动化测试不得更改 CI 主机全局 ptrace 配置；使用可启动的子进程调试场景作为稳定基线，附加测试在允许的 runner 上单独运行。

## 10. 扩展机制

现有扩展通常同时导出业务服务和 WPF 视图，不能承诺二进制兼容。首个版本只装载随产品发布并经过测试的内置模块。

后续扩展模型分成两类：

- 后端扩展：实现受版本化接口的 .NET 插件，提供反编译器、分析器、格式识别或调试 Provider。需要单独的 AssemblyLoadContext、版本检查和卸载策略。
- 前端扩展：通过清单贡献命令、菜单、工具窗口或文档类型。不得获得未经授权的 Node/Electron API。

不允许扩展通过任意 HTML 字符串或远程 URL 注入主渲染进程。第三方扩展上线前另行设计权限、信任提示、签名和故障隔离；不要在 MVP 中仓促开放不受控插件执行。

## 11. 构建、开发与发布

### 11.1 本地开发命令

提供跨平台脚本，并保证脚本不依赖 Bash 专属行为才能在 Windows 使用：

```text
pnpm bootstrap        # 检查 Node、pnpm、dotnet 版本并恢复依赖
pnpm dev              # 构建/监视后端，启动 Electron 开发环境
pnpm test             # 前端、协议和后端快速测试
pnpm test:e2e         # Electron 端到端测试
pnpm package:linux    # 发布后端并生成 Linux 安装包
```

根目录增加锁定 SDK 的 `global.json`，但在合入前验证不会破坏现有 Windows CI。Node 使用受维护的 LTS，pnpm 版本通过 `packageManager` 固定。

### 11.2 打包结构

```text
resources/
  app.asar
  backend/
    linux-x64/dnSpy.Backend.Host
  debugger/
    linux-x64/netcoredbg            # 仅在通过再分发审查后包含
  licenses/
```

- .NET 后端使用 self-contained、非 single-file 发布作为初始方案，便于诊断依赖和符号。验证稳定后再评估 single-file。
- Electron 主进程根据 `process.platform` 和 `process.arch` 选择精确资源目录，不从 `PATH` 误启动另一个同名后端。
- 打包阶段生成前端、后端、调试器及第三方依赖 SBOM 和许可证清单。
- 安装包提供应用图标、`.desktop` 文件和可选 MIME 关联；默认不抢占系统文件关联。
- 更新机制不进入 MVP。首版通过正常安装包升级，避免在未完成签名和回滚设计前加入自动更新。

### 11.3 CI 矩阵

| Job | 系统 | 内容 |
| --- | --- | --- |
| Existing Windows | Windows | 原 `dnSpy.sln` 构建及原有测试，防止回归 |
| Backend | Ubuntu | restore、build、unit、architecture、protocol tests |
| Frontend | Ubuntu | lint、typecheck、unit、bundle |
| Electron E2E X11 | Ubuntu + Xvfb | 打开程序集、导航、编辑、保存、调试样例 |
| Electron E2E Wayland | Ubuntu | 关键窗口、缩放、拖放和输入冒烟测试 |
| Package | Ubuntu | AppImage/deb 生成、安装和干净环境启动 |
| Compatibility smoke | Debian/Fedora container/VM | 后端和安装包冒烟测试 |
| Security | Ubuntu | npm/.NET 漏洞扫描、SBOM、Electron 配置检查 |

发布分支必须保存安装产物、校验和、协议版本、测试报告和第三方许可证。Linux 安装冒烟测试要在不预装 .NET SDK 的干净环境执行，以验证 self-contained 后端确实完整。

## 12. 测试策略

### 12.1 后端测试

- 单元测试：程序集树、反编译选项、token/span 映射、搜索、编辑事务和路径行为。
- Golden tests：对固定程序集生成反编译文本和结构化 span，与审阅后的基线比较。
- 往返测试：打开、修改、保存、重新打开，验证元数据和方法体变化且原文件未损坏。
- 属性/模糊测试：畸形 PE、损坏元数据、极深泛型和异常资源，后端应返回受控错误而非崩溃。
- 进程协议测试：真实启动 Host，覆盖取消、并发请求、超时、旧 session 事件和非正常退出。
- 调试集成测试：对 `samples/DebugScenarios` 执行断点、单步、局部变量、异常和退出流程。

### 12.2 前端测试

- 命令测试：每个菜单/工具栏命令在不同 capability 和选择状态下的显示及启用逻辑。
- 组件测试：树的延迟加载、标签恢复、dock 拖放、错误状态、空状态和超长文本。
- E2E：打开文件、展开类型、反编译、跳转、搜索、修改、另存、重启恢复布局、启动调试。
- 视觉回归：四个主题、三种窗口尺寸、至少两种缩放比例；参考上游默认布局。
- 可访问性：键盘可达、焦点可见、菜单方向键、屏幕阅读器标签和高对比度。
- 故障注入：后端启动失败、RPC 超时、后端中途退出、调试器退出、只读文件和磁盘空间不足。

### 12.3 性能预算

先固定一台 CI/基准机器和样例程序集，再把以下目标作为合入门禁：

- 冷启动到可交互窗口不超过 4 秒。
- 打开 100 MiB 程序集到显示根节点不超过 5 秒。
- 已加载模块的普通类型反编译 P95 不超过 2 秒。
- 滚动代码、树和十六进制视图时不执行超过 50 ms 的渲染线程长任务。
- 空工作区稳定后的前后端合计 RSS 目标不超过 500 MiB。

这些数值是初始预算，不是通过隐藏加载状态来达成的指标。基准表需记录 CPU、磁盘、运行时和测试输入；若实际基线证明不合理，以 ADR 调整数值并说明原因。

## 13. 分阶段实施计划

工期以“人周”表示，实际日历时间取决于并行人数和上游代码可提取程度。

### 阶段 0：依赖审计与关键 PoC（1-2 人周）

- 输出程序集/类型级平台依赖清单。
- 验证在纯 `net10.0` 项目中用 dnlib 和 ILSpy 打开并反编译样例程序集。
- 验证 Electron 主进程启动 .NET 后端、握手、取消和退出监管。
- 验证 `netcoredbg` DAP 的启动、断点、单步、局部变量及许可证条件。
- 用 React 实现默认 dock 布局 PoC，验证高 DPI 和持久化。

退出条件：三个 PoC 均通过；调试器和 dock 选型形成 ADR；发现的 Windows-only 依赖已有处置分类。

### 阶段 1：工程骨架与协议（2-3 人周）

- 建立 `CrossPlatform/` 目录、解决方案、前端 workspace 和 CI。
- 建立 schema 生成、JSON-RPC Host、preload 白名单 API、日志和崩溃处理。
- 实现工作区生命周期、设置路径、主题骨架和命令注册表。

退出条件：Linux 干净环境可启动空应用；前后端版本错误能友好失败；Windows 原构建不受影响。

### 阶段 2：只读浏览与反编译 Alpha（3-5 人周）

- 打开文件/目录、程序集树延迟加载、文档标签和历史导航。
- C#/VB/IL 反编译、Monaco 分类显示、定义/引用跳转。
- 输出窗口、状态栏、最近文件、布局恢复和四个主题。

退出条件：核心查看工作流可日常使用，视觉布局通过上游对照评审，大程序集满足首批性能预算。

### 阶段 3：搜索、分析、元数据与十六进制（3-5 人周）

- 流式搜索和取消。
- 引用分析、元数据表、PE 信息、分页十六进制视图。
- 多文档组、上下文菜单和主要快捷键对齐。

退出条件：只读功能矩阵达到稳定版范围，后端压力测试无句柄/内存持续增长。

### 阶段 4：编辑与保存 Beta（4-6 人周）

- 事务、撤销/重做、诊断和冲突检测。
- 方法/IL/资源/常见元数据编辑。
- 原子另存、覆盖确认、签名相关提示和往返测试。

退出条件：所有支持的编辑类型均有往返测试，故障注入不会损坏原始文件。

### 阶段 5：CoreCLR 调试 Beta（4-6 人周）

- 启动/附加、断点、单步、异常、线程、调用栈、Locals、Watch、Modules。
- 反编译文档与运行时模块/IL offset 映射。
- ptrace 权限、调试器崩溃和不支持运行时的诊断体验。
- Mono/Unity Provider 可在本阶段做实验性接入，不阻塞 CoreCLR 稳定门禁。

退出条件：调试样例在 X11/Wayland CI 连续稳定运行，调试器异常退出不会带走工作区。

### 阶段 6：发布加固（3-4 人周）

- AppImage、deb、可选 RPM，许可证、SBOM、校验和。
- 可访问性、视觉回归、性能优化、崩溃诊断和文档。
- 在支持矩阵的干净系统完成安装、升级和卸载测试。

退出条件：满足第 14 节验收标准，发布 Linux Preview；经过一轮真实用户反馈后再标记稳定。

总量粗估为 20-31 人周。由 2-3 名熟悉 .NET、Electron 和调试协议的工程师并行实施，通常需要约 3-5 个月；调试表达式求值、复杂程序集编辑和扩展系统是最容易拉长周期的部分，应以阶段门禁重新估算，而不是把此区间当作固定承诺。

## 14. 验收标准

Linux Preview 至少满足：

1. 在全新 Ubuntu 24.04 x64 环境中无需 Wine、无需预装 .NET SDK 即可安装和启动。
2. 能打开仓库样例及真实的大型程序集，浏览树并生成 C#、VB、IL 文档。
3. 定义跳转、后退/前进、搜索、分析和十六进制范围读取可工作且可取消。
4. 能完成至少一种高级方法编辑和一种 IL 编辑，另存后重新打开验证结果；默认不修改原文件。
5. 能启动一个 .NET 样例，命中断点，单步，查看调用栈、局部变量和监视表达式，然后正常结束。
6. 默认布局、菜单分组、工具栏、四向工具窗口、状态栏和四个主题通过上游对照检查。
7. 关闭并重新启动后恢复主题、窗口尺寸、dock 布局和最近工作区；损坏的布局配置可自动回退默认值。
8. 后端崩溃、调试器崩溃、无权限附加、文件只读和协议版本不匹配都有明确错误，Electron 不进入无响应或无限重启。
9. Electron 安全配置检查通过，渲染进程不能直接访问 Node、文件系统、后端进程或任意 IPC channel。
10. Windows 原版的 CI 构建继续通过；共享逻辑迁移没有改变现有 Windows 行为。

标记 Linux Stable 之前还应满足：

- Preview 的阻断级和数据损坏级问题清零。
- 支持矩阵内所有发行版完成安装和核心工作流冒烟测试。
- 性能预算达标或已有审阅通过的 ADR 说明调整原因。
- netcoredbg 等可分发组件的许可证和第三方声明完成审查。
- 发布包、校验和、SBOM、许可证、已知限制和故障排查文档齐全。

## 15. 主要风险与缓解措施

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| 业务逻辑和 WPF 契约耦合比预期更深 | 后端提取延期 | 阶段 0 做类型级依赖审计；按用例提取；禁止跨平台项目引用 UI 契约 |
| Electron UI 与上游交互偏差 | 用户迁移成本高 | WPF 源码作为事实来源；命令清单、布局快照、视觉与 E2E 双重回归 |
| netcoredbg 能力或再分发条件不满足 | Linux 调试延期 | 阶段 0 提前门禁；调试 Provider 可替换；必要时采用外部安装发现模式 |
| 大程序集导致 IPC、树和编辑器卡顿 | 产品不可用 | 延迟树、分页、批量事件、取消、虚拟列表和性能门禁 |
| 编辑失败损坏用户文件 | 严重数据风险 | 默认另存、事务版本、临时文件校验、原子替换和故障注入测试 |
| Electron 增加攻击面 | 本地文件和代码执行风险 | sandbox、context isolation、严格 preload 白名单、CSP、fuses 和依赖审计 |
| 现有 MEF 扩展不兼容 | 生态功能缺失 | 明确不承诺二进制兼容；优先迁移内置扩展；设计版本化的新扩展点 |
| Linux 发行版/显示服务器差异 | 打包和输入问题 | LTS 必测、X11/Wayland E2E、减少系统原生库依赖、提供 AppImage 与 deb |
| 同时维护 WPF 与 Electron 造成双份逻辑 | 修复漂移 | 业务逻辑下沉共享核心；前端只保留表现逻辑；共享 golden tests |

## 16. 推荐的首批任务拆分

可以直接按以下顺序创建工作项：

1. `ADR-001`：确认 Electron/React + 独立 .NET 后端架构。
2. `ADR-002`：验证并选择 React dock 库。
3. `ADR-003`：确认 JSON-RPC framing、schema 生成和版本规则。
4. `SPIKE-001`：提取最小无 UI 反编译链路到 `net10.0`。
5. `SPIKE-002`：Electron 启动/监管后端及安全 preload。
6. `SPIKE-003`：netcoredbg DAP、许可证和无源码断点验证。
7. `CORE-001`：工作区、模块 ID、树延迟加载和资源释放。
8. `CORE-002`：反编译文本及 span/navigation DTO。
9. `UI-001`：上游一致的 AppShell、默认 dock 布局和持久化。
10. `UI-002`：Assembly Explorer、Monaco 文档和命令注册表。
11. `TEST-001`：协议进程测试、golden 程序集和 Electron E2E 骨架。
12. `CI-001`：Linux 构建、Xvfb E2E 和 Windows 回归并行流水线。

前三个 Spike 完成后重新核定阶段 2-6 的范围和工期。若其中任一核心假设失败，应替换对应组件，不改变“跨平台后端 + 版本化协议 + React 表现层”的总体边界。
