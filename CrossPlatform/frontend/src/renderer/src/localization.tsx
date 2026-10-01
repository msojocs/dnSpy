import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { UiLocale } from '../../shared/protocol'

export type LanguagePreference = 'system' | UiLocale

type TranslationValues = Record<string, string | number>

const zhCN: Record<string, string> = {
  'File': '文件',
  'Edit': '编辑',
  'View': '视图',
  'Language': '语言',
  'Debug': '调试',
  'Window': '窗口',
  'Help': '帮助',
  'Open...': '打开...',
  'Save As...': '另存为...',
  'Close Workspace': '关闭工作区',
  'Exit': '退出',
  'Undo': '撤销',
  'Redo': '重做',
  'Find': '查找',
  'Rename...': '重命名...',
  'Edit IL Body...': '编辑 IL 方法体...',
  'Replace Resource...': '替换资源...',
  'Blue Theme': '蓝色主题',
  'Light Theme': '浅色主题',
  'Dark Theme': '深色主题',
  'High Contrast': '高对比度',
  'Hex View': '十六进制视图',
  'Hex': '十六进制',
  'Info': '信息',
  'Module Information': '模块信息',
  'System Default': '跟随系统',
  'English': 'English',
  'Simplified Chinese': '简体中文',
  'Continue': '继续',
  'Start Debugging': '开始调试',
  'Attach to Process...': '附加到进程...',
  'Pause': '暂停',
  'Step Into': '逐语句',
  'Step Over': '逐过程',
  'Stop Debugging': '停止调试',
  'Stop': '停止',
  'Assembly Explorer': '程序集资源管理器',
  'Output': '输出',
  'Search': '搜索',
  'Analyzer': '分析器',
  'Locals': '局部变量',
  'Watch': '监视',
  'Call Stack': '调用堆栈',
  'Breakpoints': '断点',
  'Threads': '线程',
  'Modules': '模块',
  'Start': '开始',
  'About dnSpy': '关于 dnSpy',
  'Workspace': '工作区',
  'Open Assembly': '打开程序集',
  'Save As': '另存为',
  'Back': '后退',
  'Forward': '前进',
  'Working': '正在处理',
  'Ready': '就绪',
  'Modified': '已修改',
  'Dismiss': '关闭提示',
  'Loading': '正在加载',
  'No assemblies loaded': '未加载程序集',
  'Collapse': '折叠',
  'Expand': '展开',
  'Main toolbar': '主工具栏',
  'Window controls': '窗口控件',
  'Minimize window': '最小化窗口',
  'Maximize window': '最大化窗口',
  'Restore window': '还原窗口',
  'Minimize': '最小化',
  'Maximize': '最大化',
  'Restore': '还原',
  'Close window': '关闭窗口',
  'Close': '关闭',
  'Search assemblies': '搜索程序集',
  'Document closed': '文档已关闭',
  'Decompiler language': '反编译语言',
  'Definition': '定义',
  'Go to definition (F12)': '转到定义 (F12)',
  'Previous page': '上一页',
  'Next page': '下一页',
  'Offset': '偏移',
  'Name': '名称',
  'Value': '值',
  'Type': '类型',
  'Path': '路径',
  'Runtime': '运行时',
  'Architecture': '架构',
  'Kind': '类型',
  'Entry point': '入口点',
  'Types': '类型',
  'Resources': '资源',
  'Base type': '基类型',
  'Instruction': '指令',
  'None': '无',
  'Assembly References': '程序集引用',
  'PE Headers': 'PE 头',
  'Metadata Tables': '元数据表',
  'Table': '表',
  'Rows': '行数',
  'Expression': '表达式',
  'Symbols': '符号',
  'Watch expression': '监视表达式',
  'Add watch': '添加监视',
  'Function breakpoint': '函数断点',
  'Add function breakpoint': '添加函数断点',
  'All thrown exceptions': '所有抛出的异常',
  'User-unhandled exceptions': '用户未处理的异常',
  'Attach to Process': '附加到进程',
  'Filter processes': '筛选进程',
  'Filter': '筛选',
  'Refresh': '刷新',
  'Cancel': '取消',
  'Attach': '附加',
  'Rename': '重命名',
  'Edit IL · {name}': '编辑 IL · {name}',
  'Max stack': '最大堆栈',
  'Initialize locals': '初始化局部变量',
  'Clear exception handlers': '清除异常处理程序',
  'Label': '标签',
  'Opcode': '操作码',
  'Operand': '操作数',
  'Number': '数字',
  'String': '字符串',
  'Branch': '分支',
  'Switch': '切换',
  'Local': '局部变量',
  'Argument': '参数',
  'Token': '令牌',
  'Add': '添加',
  'Apply': '应用',
  'Close About': '关闭“关于”对话框',
  'Version 1.0.0': '版本 1.0.0',
  'Cross-platform .NET assembly browser, decompiler, editor and debugger.': '跨平台 .NET 程序集浏览器、反编译器、编辑器和调试器。',
  'Licensed under GNU GPL v3.0 only.': '仅依 GNU GPL v3.0 许可证授权。',
  'Discard unsaved changes and close the workspace?': '放弃未保存的更改并关闭工作区吗？',
  'Stopped: {reason}': '已停止：{reason}',
  'starting': '正在启动',
  'ready': '就绪',
  'running': '正在运行',
  'stopped': '已停止',
  'inactive': '未启动',
  'error': '错误',
  'unknown': '未知',
  'breakpoint': '断点',
  'function breakpoint': '函数断点',
  'data breakpoint': '数据断点',
  'instruction breakpoint': '指令断点',
  'entry': '入口点',
  'step': '单步',
  'pause': '用户暂停',
  'exception': '异常',
  'Remove {name}': '移除 {name}',
  'Collapse {name}': '折叠 {name}',
  'Expand {name}': '展开 {name}',
  'Label {index}': '标签 {index}',
  'Opcode {index}': '操作码 {index}',
  'Operand kind {index}': '操作数类型 {index}',
  'Operand {index}': '操作数 {index}',
  'Delete instruction': '删除指令',
  'Delete instruction {index}': '删除指令 {index}',
  'Navigation failed: {message}': '导航失败：{message}',
  'Backend: {state}': '后端：{state}',
  'Backend: {state} - {message}': '后端：{state} - {message}',
  'Opened {count} module(s).': '已打开 {count} 个模块。',
  'Open failed: {message}': '打开失败：{message}',
  'Workspace closed.': '工作区已关闭。',
  'Tree load failed: {message}': '加载树失败：{message}',
  'No workspace is open.': '没有打开的工作区。',
  'Decompile failed: {message}': '反编译失败：{message}',
  'Search returned {count} result(s).': '搜索返回 {count} 个结果。',
  'Search failed: {message}': '搜索失败：{message}',
  'Analysis returned {count} reference(s).': '分析返回 {count} 个引用。',
  'Analysis failed: {message}': '分析失败：{message}',
  'Renamed {oldName} to {newName}.': '已将 {oldName} 重命名为 {newName}。',
  'Rename failed: {message}': '重命名失败：{message}',
  'Replaced resource {name}.': '已替换资源 {name}。',
  'Resource replacement failed: {message}': '替换资源失败：{message}',
  'Saved {path} ({length} bytes, SHA-256 {sha256}).': '已保存 {path}（{length} 字节，SHA-256 {sha256}）。',
  'Save failed: {message}': '保存失败：{message}',
  'Updated IL body for {name}.': '已更新 {name} 的 IL 方法体。',
  'Undo completed.': '撤销完成。',
  'Undo failed: {message}': '撤销失败：{message}',
  'Redo completed.': '重做完成。',
  'Redo failed: {message}': '重做失败：{message}',
  'Started debugging {target}.': '已开始调试 {target}。',
  'Debug launch failed: {message}': '启动调试失败：{message}',
  'Attached to process {processId}.': '已附加到进程 {processId}。',
  'Debug attach failed: {message}': '附加调试失败：{message}',
  'Debugger stopped: {reason}.': '调试器已停止：{reason}。',
  'Debug target exited with code {code}.': '调试目标已退出，代码为 {code}。',
  'Debug session terminated.': '调试会话已终止。',
  'Could not refresh debugger state: {message}': '无法刷新调试器状态：{message}',
  'IL edit failed: {message}': 'IL 编辑失败：{message}',
  'Close tab': '关闭选项卡',
  'Pinned': '已固定',
  'Rename tab': '重命名选项卡',
  'Close tabset': '关闭选项卡组',
  'Active tabset': '活动选项卡组',
  'Move tabset': '移动选项卡组',
  'Move tabs (?)': '移动选项卡 (?)',
  'Move group (?)': '移动组 (?)',
  'Maximize tabset': '最大化选项卡组',
  'Restore tabset': '还原选项卡组',
  'Popout selected tab': '在新窗口中打开所选选项卡',
  'Float selected tab': '浮动所选选项卡',
  'Popout panel': '在新窗口中打开面板',
  'Drag into another layout': '拖入其他布局',
  'Dock tabs (?)': '停靠选项卡 (?)',
  'Hidden tabs': '隐藏的选项卡',
  'Resize': '调整大小',
  'Error rendering component': '组件渲染失败',
  'Retry': '重试',
  'Popout Window': '弹出窗口',
  'Pin': '固定',
  'Unpin': '取消固定',
  'Popout': '弹出',
  'Float': '浮动',
  'Pop out tabset': '弹出选项卡组',
  'Float tabset': '浮动选项卡组',
  'Overlay': '覆盖',
  'Split': '拆分',
  'Close All': '全部关闭',
  'Close to the Right': '关闭右侧选项卡',
  'Close Others': '关闭其他选项卡',
  'Add to new group': '添加到新组',
  'Add to group': '添加到组',
  'Remove from group': '从组中移除',
  'Ungroup': '取消分组',
  'Rename group': '重命名组',
  'Group color': '组颜色',
  'Tab Group, click to expand/collapse': '选项卡组，单击展开或折叠',
  'Group Name': '组名称',
  'Group color ?': '组颜色 ?',
  'Group': '组',
}

function resolveSystemLocale(): UiLocale {
  const locales = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]
  return locales.some((locale) => locale.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en'
}

let activeLocale: UiLocale = resolveSystemLocale()

const resolveLocale = (language: LanguagePreference): UiLocale => language === 'system' ? resolveSystemLocale() : language

export const translate = (message: string, values: TranslationValues = {}): string => {
  const template = activeLocale === 'zh-CN' ? zhCN[message] ?? message : message
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values[name] ?? placeholder))
}

export const getActiveLocale = (): UiLocale => activeLocale

const loadLanguage = (): LanguagePreference => {
  const saved = localStorage.getItem('dnspy.language')
  return saved === 'en' || saved === 'zh-CN' || saved === 'system' ? saved : 'system'
}

interface LanguageContextValue {
  language: LanguagePreference
  locale: UiLocale
  setLanguage(language: LanguagePreference): void
  t: typeof translate
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'system',
  locale: activeLocale,
  setLanguage: () => undefined,
  t: translate,
})

export const LanguageProvider = ({ children, initialLanguage }: React.PropsWithChildren<{ initialLanguage?: LanguagePreference }>): React.JSX.Element => {
  const [language, setLanguageState] = useState<LanguagePreference>(() => initialLanguage ?? loadLanguage())
  const locale = resolveLocale(language)
  activeLocale = locale

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dataset.locale = locale
    if (initialLanguage === undefined)
      localStorage.setItem('dnspy.language', language)
    void window.dnSpy?.setLocale?.(locale)
  }, [initialLanguage, language, locale])

  const setLanguage = useCallback((nextLanguage: LanguagePreference) => setLanguageState(nextLanguage), [])
  const context = useMemo<LanguageContextValue>(() => ({ language, locale, setLanguage, t: translate }), [language, locale, setLanguage])
  return <LanguageContext.Provider value={context}>{children}</LanguageContext.Provider>
}

export const useLanguage = (): LanguageContextValue => useContext(LanguageContext)
