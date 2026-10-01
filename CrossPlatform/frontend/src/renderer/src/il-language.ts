import type { editor, languages } from 'monaco-editor'

const opcodes = [
  'add', 'add.ovf', 'add.ovf.un', 'and', 'arglist', 'beq', 'beq.s', 'bge', 'bge.s', 'bge.un', 'bge.un.s',
  'bgt', 'bgt.s', 'bgt.un', 'bgt.un.s', 'ble', 'ble.s', 'ble.un', 'ble.un.s', 'blt', 'blt.s', 'blt.un',
  'blt.un.s', 'bne.un', 'bne.un.s', 'box', 'br', 'br.s', 'break', 'brfalse', 'brfalse.s', 'brtrue',
  'brtrue.s', 'call', 'calli', 'callvirt', 'castclass', 'ceq', 'cgt', 'cgt.un', 'ckfinite', 'clt', 'clt.un',
  'constrained.', 'conv.i', 'conv.i1', 'conv.i2', 'conv.i4', 'conv.i8', 'conv.ovf.i', 'conv.ovf.i.un',
  'conv.ovf.i1', 'conv.ovf.i1.un', 'conv.ovf.i2', 'conv.ovf.i2.un', 'conv.ovf.i4', 'conv.ovf.i4.un',
  'conv.ovf.i8', 'conv.ovf.i8.un', 'conv.ovf.u', 'conv.ovf.u.un', 'conv.ovf.u1', 'conv.ovf.u1.un',
  'conv.ovf.u2', 'conv.ovf.u2.un', 'conv.ovf.u4', 'conv.ovf.u4.un', 'conv.ovf.u8', 'conv.ovf.u8.un',
  'conv.r.un', 'conv.r4', 'conv.r8', 'conv.u', 'conv.u1', 'conv.u2', 'conv.u4', 'conv.u8', 'cpblk', 'cpobj',
  'div', 'div.un', 'dup', 'endfilter', 'endfinally', 'initblk', 'initobj', 'isinst', 'jmp', 'ldarg', 'ldarg.0',
  'ldarg.1', 'ldarg.2', 'ldarg.3', 'ldarg.s', 'ldarga', 'ldarga.s', 'ldc.i4', 'ldc.i4.0', 'ldc.i4.1',
  'ldc.i4.2', 'ldc.i4.3', 'ldc.i4.4', 'ldc.i4.5', 'ldc.i4.6', 'ldc.i4.7', 'ldc.i4.8', 'ldc.i4.m1',
  'ldc.i4.s', 'ldc.i8', 'ldc.r4', 'ldc.r8', 'ldelem', 'ldelem.i', 'ldelem.i1', 'ldelem.i2', 'ldelem.i4',
  'ldelem.i8', 'ldelem.r4', 'ldelem.r8', 'ldelem.ref', 'ldelem.u1', 'ldelem.u2', 'ldelem.u4', 'ldelema',
  'ldfld', 'ldflda', 'ldftn', 'ldind.i', 'ldind.i1', 'ldind.i2', 'ldind.i4', 'ldind.i8', 'ldind.r4',
  'ldind.r8', 'ldind.ref', 'ldind.u1', 'ldind.u2', 'ldind.u4', 'ldlen', 'ldloc', 'ldloc.0', 'ldloc.1',
  'ldloc.2', 'ldloc.3', 'ldloc.s', 'ldloca', 'ldloca.s', 'ldnull', 'ldobj', 'ldsfld', 'ldsflda', 'ldstr',
  'ldtoken', 'ldvirtftn', 'leave', 'leave.s', 'localloc', 'mkrefany', 'mul', 'mul.ovf', 'mul.ovf.un', 'neg',
  'newarr', 'newobj', 'no.', 'nop', 'not', 'or', 'pop', 'readonly.', 'refanytype', 'refanyval', 'rem',
  'rem.un', 'ret', 'rethrow', 'shl', 'shr', 'shr.un', 'sizeof', 'starg', 'starg.s', 'stelem', 'stelem.i',
  'stelem.i1', 'stelem.i2', 'stelem.i4', 'stelem.i8', 'stelem.r4', 'stelem.r8', 'stelem.ref', 'stfld',
  'stind.i', 'stind.i1', 'stind.i2', 'stind.i4', 'stind.i8', 'stind.r4', 'stind.r8', 'stind.ref', 'stloc',
  'stloc.0', 'stloc.1', 'stloc.2', 'stloc.3', 'stloc.s', 'stobj', 'stsfld', 'sub', 'sub.ovf', 'sub.ovf.un',
  'switch', 'tail.', 'throw', 'unaligned.', 'unbox', 'unbox.any', 'volatile.', 'xor',
]

const directives = [
  '.addon', '.algorithm', '.assembly', '.backing', '.class', '.corflags', '.custom', '.data', '.emitbyte',
  '.entrypoint', '.event', '.export', '.field', '.file', '.fire', '.get', '.hash', '.imagebase', '.language',
  '.line', '.locale', '.locals', '.manifestres', '.maxstack', '.method', '.module', '.mresource', '.namespace',
  '.other', '.override', '.pack', '.param', '.permission', '.permissionset', '.property', '.publickey',
  '.publickeytoken', '.removeon', '.set', '.size', '.stackreserve', '.subsystem', '.try', '.ver', '.vtentry',
  '.vtfixup', '.zeroinit',
]

const typeKeywords = [
  'bool', 'char', 'class', 'float32', 'float64', 'int', 'int8', 'int16', 'int32', 'int64', 'native', 'object',
  'string', 'typedref', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'unsigned', 'valuetype', 'void',
]

const modifiers = [
  'abstract', 'algorithm', 'alignment', 'ansi', 'any', 'assembly', 'auto', 'autochar', 'beforefieldinit',
  'bytearray', 'catch', 'cdecl', 'cil', 'default', 'endfault', 'endfilter', 'endfinally', 'enum', 'error',
  'explicit', 'extends', 'extern', 'famandassem', 'family', 'famorassem', 'fault', 'field', 'final', 'finally',
  'forwardref', 'fromunmanaged', 'handler', 'hidebysig', 'hresult', 'implements', 'implicitcom', 'import', 'in',
  'initonly', 'instance', 'interface', 'internalcall', 'literal', 'managed', 'marshal', 'method', 'modopt', 'modreq',
  'nested', 'newslot', 'noinlining', 'nomangle', 'nometadata', 'noncasdemand', 'noncasinheritance',
  'noncaslinkdemand', 'notserialized', 'opt', 'out', 'permitonly', 'pinned', 'pinvokeimpl', 'preservesig',
  'private', 'privatescope', 'public', 'request', 'reqmin', 'reqopt', 'reqrefuse', 'rtspecialname', 'runtime',
  'sealed', 'sequential', 'serializable', 'specialname', 'static', 'stdcall', 'struct', 'synchronized', 'thiscall',
  'tls', 'to', 'try', 'unicode', 'unmanaged', 'vararg', 'virtual', 'winapi',
]

export const ilThemeRules = {
  light: createThemeRules({
    directive: '0000FF', opcode: 'AF00DB', modifier: '0000FF', type: '267F99', offset: '098658',
    variable: '001080', member: '795E26', string: 'A31515', number: '098658', comment: '008000',
  }),
  dark: createThemeRules({
    directive: '569CD6', opcode: 'C586C0', modifier: '4FC1FF', type: '4EC9B0', offset: 'D7BA7D',
    variable: '9CDCFE', member: 'DCDCAA', string: 'CE9178', number: 'B5CEA8', comment: '6A9955',
  }),
  highContrast: createThemeRules({
    directive: '6FC3DF', opcode: 'DDB6F2', modifier: '9CDCFE', type: '4EC9B0', offset: 'FFD700',
    variable: '9CDCFE', member: 'FFFF00', string: 'FF9D88', number: 'B5CEA8', comment: '7CA668',
  }),
} satisfies Record<string, editor.ITokenThemeRule[]>

interface ILThemePalette {
  directive: string
  opcode: string
  modifier: string
  type: string
  offset: string
  variable: string
  member: string
  string: string
  number: string
  comment: string
}

function createThemeRules(palette: ILThemePalette): editor.ITokenThemeRule[] {
  return [
    { token: 'keyword.directive.il', foreground: palette.directive },
    { token: 'keyword.opcode.il', foreground: palette.opcode, fontStyle: 'bold' },
    { token: 'keyword.modifier.il', foreground: palette.modifier },
    { token: 'type.keyword.il', foreground: palette.type },
    { token: 'type.identifier.il', foreground: palette.type },
    { token: 'constant.offset.il', foreground: palette.offset },
    { token: 'constant.module-id.il', foreground: palette.variable },
    { token: 'variable.il', foreground: palette.variable },
    { token: 'identifier.member.il', foreground: palette.member },
    { token: 'string.il', foreground: palette.string },
    { token: 'string.escape.il', foreground: palette.string },
    { token: 'number.il', foreground: palette.number },
    { token: 'number.float.il', foreground: palette.number },
    { token: 'number.hex.il', foreground: palette.number },
    { token: 'comment.il', foreground: palette.comment },
  ]
}

export const ilLanguage: languages.IMonarchLanguage = {
  defaultToken: '',
  ignoreCase: true,
  tokenPostfix: '.il',
  opcodes,
  directives,
  typeKeywords,
  modifiers,
  tokenizer: {
    root: [
      [/[ \t\r\n]+/, ''],
      [/\/\//, 'comment', '@lineComment'],
      [/\/\*/, 'comment', '@blockComment'],
      [/(<Module>)(\{)([^}\r\n]+)(\})(::)([a-z_$?@<][\w$?@.`<>]*)/, [
        'type.identifier', '@brackets', 'constant.module-id', '@brackets', 'delimiter', 'identifier.member',
      ]],
      [/(<Module>)(\{)([^}\r\n]+)(\})/, [
        'type.identifier', '@brackets', 'constant.module-id', '@brackets',
      ]],
      [/\.[a-z_][\w.]*/, {
        cases: {
          '@directives': 'keyword.directive',
          '@default': 'identifier.member',
        },
      }],
      [/\bIL_[0-9a-f]+\b(?=:?)/, 'constant.offset'],
      [/\b(?:V|A)_[0-9]+\b/, 'variable'],
      [/\[[^\]\r\n]+\]/, 'type.identifier'],
      [/"/, 'string', '@string'],
      [/'(?:[^'\\]|\\.)*'/, 'string'],
      [/0x[0-9a-f]+|[0-9a-f]{8}(?=\s*\})/, 'number.hex'],
      [/[+-]?(?:\d+\.\d*|\.\d+)(?:e[+-]?\d+)?/, 'number.float'],
      [/[+-]?\d+/, 'number'],
      [/([a-z_$?@<][\w$?@.`<>]*)(::)([a-z_$?@<][\w$?@.`<>]*)/, ['type.identifier', 'delimiter', 'identifier.member']],
      [/<Module>/, 'type.identifier'],
      [/<[^>\r\n]+>[\w$?@.`]*/, 'identifier.member'],
      [/[a-z_$?@<][\w$?@.`<>]*(?=\s*\()/, 'identifier.member'],
      [/[a-z_$?@<][\w$?@`<>]*(?:\.[a-z_$?@<][\w$?@`<>]*)+/, 'type.identifier'],
      [/[a-z_$?@][\w$?@`]*(?:<[^>\r\n]+>)/, 'type.identifier'],
      [/[a-z_$?@][\w$?@.`]*/, {
        cases: {
          '@opcodes': 'keyword.opcode',
          '@typeKeywords': 'type.keyword',
          '@modifiers': 'keyword.modifier',
          '@default': 'identifier',
        },
      }],
      [/[{}()[\]]/, '@brackets'],
      [/[,.:=*&<>+\-/]/, 'delimiter'],
    ],
    lineComment: [
      [/.+$/, 'comment', '@pop'],
      [/$/, 'comment', '@pop'],
    ],
    blockComment: [
      [/[^*/]+/, 'comment'],
      [/\/\*/, 'comment', '@push'],
      [/\*\//, 'comment', '@pop'],
      [/[*/]/, 'comment'],
    ],
    string: [
      [/[^"\\]+/, 'string'],
      [/\\(?:[abfnrtv\\"']|u[0-9a-f]{4}|x[0-9a-f]+|[0-7]{1,3})/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],
  },
}

export const ilLanguageConfiguration: languages.LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  folding: { markers: { start: /^\s*\/\/\s*#?region\b/, end: /^\s*\/\/\s*#?endregion\b/ } },
}
