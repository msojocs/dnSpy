# dnSpy Linux 使用指南

## 支持范围

Linux 版使用 Electron/React 前端和独立的 .NET 10 后端，无需 Wine，也无需预装 .NET SDK。当前支持：

- 打开单个或多个 `.dll`、`.exe`、`.netmodule`、`.winmd` 文件。
- 展开程序集、命名空间、类型、成员、引用、资源和 `.resources` 条目。
- 反编译 C#、Visual Basic、IL，以及把 BAML 恢复为 XAML。
- 名称/字符串搜索、引用分析、模块信息和分页十六进制查看。
- 类型及成员重命名、结构化 IL 方法体编辑、嵌入资源替换和原子另存。
- 启动或附加 Linux .NET/CoreCLR 进程，使用函数断点、异常断点、继续、暂停、单步、线程、调用栈、局部变量、监视和模块窗口。

Linux 不提供 Windows CorDebug、.NET Framework 运行时调试、Windows 专属反调试绕过或 WPF 设计预览。WPF 程序集仍可查看、反编译和编辑；BAML 可以恢复为 XAML。

## 安装

### Debian/Ubuntu

```bash
sudo apt install ./dnSpy-1.0.0-amd64.deb
dnspy
```

可以从命令行直接打开程序集：

```bash
dnspy --open ./Example.dll
```

deb 安装脚本会根据系统是否允许非特权 user namespace，配置 Electron sandbox helper。卸载应用不会删除用户配置。

### AppImage

```bash
chmod +x dnSpy-1.0.0-x86_64.AppImage
./dnSpy-1.0.0-x86_64.AppImage
```

AppImage 需要系统允许 Chromium user namespace sandbox。在启用了严格 AppArmor 限制且不能创建 user namespace 的 Ubuntu 系统上，使用 deb 包；不要以 `--no-sandbox` 作为日常运行方式。

## 配置和日志

应用遵循 XDG Base Directory：

- 配置：`${XDG_CONFIG_HOME:-$HOME/.config}/dnspy`
- 缓存：`${XDG_CACHE_HOME:-$HOME/.cache}/dnspy`
- Electron 配置：`${XDG_CONFIG_HOME:-$HOME/.config}/dnSpy`

界面语言默认跟随系统语言，也可以从“语言”菜单选择 `English` 或“简体中文”；更改后立即生效。

应用布局、主题和语言选择由 Electron 用户数据目录保存。布局损坏时，可以在应用关闭后删除对应 Electron 配置目录中的 Local Storage；下次启动会恢复默认布局和系统语言设置。

## 常用快捷键

| 快捷键 | 命令 |
| --- | --- |
| `Ctrl+O` | 打开程序集 |
| `Ctrl+F` | 打开搜索窗口 |
| `Ctrl+Shift+S` | 另存当前模块 |
| `F2` | 重命名选中类型或成员 |
| `F5` | 启动调试/继续 |
| `Shift+F5` | 停止调试 |
| `F10` | 单步跳过 |
| `F11` | 单步进入 |

## Linux 调试权限

启动的子进程通常不需要额外权限。附加到现有进程时，目标必须属于同一用户，并且受到 Yama、容器、SELinux 或 AppArmor 策略约束。

查看当前 Yama 设置：

```bash
cat /proc/sys/kernel/yama/ptrace_scope
```

dnSpy 不会自动运行 `sudo`，也不会修改全局 ptrace 设置。附加失败时，应优先检查目标用户、容器权限和系统安全策略。只在理解安全影响后，由系统管理员调整策略。

## 从源码构建

需要 .NET 10 SDK、Node.js 22 和 pnpm 12.3.4：

```bash
cd CrossPlatform
pnpm install --frozen-lockfile
./scripts/install-netcoredbg.sh
dotnet test dnSpy.CrossPlatform.slnx -m:1 -p:UseSharedCompilation=false
pnpm --dir frontend build
pnpm --dir frontend test:e2e
pnpm package:linux
```

安装包输出到 `CrossPlatform/artifacts/packages/`。`install-netcoredbg.sh` 固定下载 `3.2.0-1092`，并在解压前校验 SHA-256；应用运行时不会联网下载调试器。
