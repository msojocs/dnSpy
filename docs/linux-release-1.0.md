# dnSpy Linux 1.0.0

dnSpy Linux 1.0.0 是 Electron/React 前端与跨平台 .NET 10 后端的首个稳定版。Windows/WPF 产品线保持独立，未被替换。

## 交付物

构建输出位于 `CrossPlatform/artifacts/packages/`：

| 文件 | SHA-256 |
| --- | --- |
| `dnSpy-1.0.0-x86_64.AppImage` | `eebc03c8b13a7e613e142e8541af105ba69e2ee0cbd8976a1a4bc9a63617e053` |
| `dnSpy-1.0.0-amd64.deb` | `853645782ebc9d2a5eb4ab64a4b96035735bbb9a43359352cda2bcd6c6da69ee` |

> 上表哈希来自改用进程内 ICorDebug 引擎之前的构建；重新执行 `pnpm package:linux` 后需用 `sha256sum` 刷新。

两个包都包含 self-contained .NET 后端、`libdbgshim.so`（`Microsoft.Diagnostics.DbgShim`，MIT）、GPL/MIT/第三方声明和 CycloneDX 1.6 SBOM。调试引擎在进程内运行，不存在独立的调试器可执行文件，运行时也不下载。

## 稳定版功能

- 程序集/目录工作区、延迟树、最近工作区和持久化停靠布局。
- C#、Visual Basic、IL 反编译；BAML 到 XAML；F12/Ctrl+Click 和 Back/Forward。
- 名称/字符串搜索、跨模块引用分析、PE Headers、ECMA-335 Metadata Tables 和分页 Hex。
- 类型/成员重命名、结构化 IL 方法体编辑、嵌入资源替换、Undo/Redo、原子 Save As。
- CoreCLR launch/attach，在反编译源码上设行断点（IL 偏移，无需 PDB）和方法断点，继续/暂停/单步、线程、调用栈、可展开 Locals 和 Modules。异常断点与表达式求值/Watch 不在范围内，界面已降级。
- 深色、浅色、蓝色和高对比主题。
- `--open <assembly>` 命令行入口。

## 验证结果

- .NET Release tests：13/13。
- React/Vitest：2/2。
- Electron workflow tests：7/7。
- Packaged unpacked application：通过。
- Packaged AppImage：通过。
- Ubuntu 24.04 clean container：deb 安装、self-contained Host 启动、`libdbgshim.so` 与 `libmscordbi.so` 加载通过，无 .NET SDK。
- Debian 13/Fedora 44：Host 与调试引擎兼容冒烟通过。
- pnpm audit：0 known vulnerabilities。
- NuGet direct/transitive vulnerability audit：0 known vulnerabilities。
- Electron fuses：RunAsNode、NODE_OPTIONS、CLI inspect 和额外 file privilege 已关闭；ASAR integrity 与 only-load-from-ASAR 已开启。

## 平台边界

- Linux 上不支持 Windows CorDebug 和 .NET Framework 运行时调试。
- WPF 程序集可浏览、反编译、编辑，BAML 可恢复为 XAML；不提供 WPF 设计预览。
- Mono/Unity 软调试和第三方扩展 SDK 不属于 1.0.0 稳定范围。
- 首个稳定包目标为 glibc Linux x64。arm64 构建需要单独的 `Microsoft.Diagnostics.DbgShim` 资产和发行版验证。
- 调试不含异常断点与表达式求值；`async` 单步不做求值判定 continuation，分支/异常路径上可能多停一次。

安装、快捷键和 ptrace 排查见 [linux-user-guide.md](linux-user-guide.md)。架构与实施记录见 [linux-support-plan.md](linux-support-plan.md)。
