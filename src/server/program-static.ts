import { parse } from 'acorn';

/** 固定工具链对转译后的模块执行保守能力检查；不执行源码。 */
export function assertDeterministicModule(source: string) {
  const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
  const nondeterministic = new Set(['Date', 'performance', 'crypto', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'Intl', 'Temporal']);
  const forbidden = new Set(['globalThis', 'window', 'document', 'self', 'top', 'parent', 'frames', 'navigator', 'location', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'process', 'Deno', 'Bun', 'require', 'eval', 'Function', 'Reflect', 'Proxy', 'WebAssembly', 'Atomics', 'SharedArrayBuffer', 'WeakRef', 'FinalizationRegistry', 'console']);
  const keys = new Set(['constructor', 'prototype', '__proto__', 'callee', 'caller', 'arguments', 'ownerDocument', 'contentWindow', 'dangerouslySetInnerHTML', 'ref', 'toLocaleString', 'localeCompare', 'registerRoot', 'Composition', 'Internals', 'useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useState', 'useReducer', 'useRef', 'useId', 'useSyncExternalStore', 'useImperativeHandle', 'createContext', 'useContext', 'createPortal', '$$typeof', '_owner', '_store', 'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'assign', 'defineProperty', 'setPrototypeOf', 'next', 'compile', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'fromAsync', 'then', 'type', 'props', 'defaultProps', 'render']);
  const allowedImports: Record<string, Set<string>> = {
    react: new Set(['useMemo', 'useCallback', 'Fragment']),
    'react/jsx-runtime': new Set(['jsx', 'jsxs', 'Fragment']),
    remotion: new Set(['AbsoluteFill', 'Sequence', 'Series', 'Img', 'interpolate', 'interpolateColors', 'spring', 'Easing', 'random', 'useCurrentFrame', 'useVideoConfig']),
    '@narracut/runtime': new Set(['getSceneFrame', 'findSceneAtFrame', 'findAssetById']),
  };
  let ast: any;
  try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); }
  catch { return fail('TYPECHECK_FAILED', '源码语法无效。'); }
  type Scope = { names: Set<string>; parent?: Scope };
  const scopes = new WeakMap<object, Scope>();
  const globals = new Set(['undefined', 'NaN', 'Infinity', 'Math', 'Number', 'String', 'Boolean', 'Array', 'JSON']);
  const walk = (node: any, fn: (node: any, parent?: any, key?: string) => void, parent?: any, key?: string) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') fn(node, parent, key);
    for (const [name, child] of Object.entries(node)) {
      if (Array.isArray(child)) child.forEach(value => walk(value, fn, node, name));
      else if (child && typeof child === 'object') walk(child, fn, node, name);
    }
  };
  function binding(node: any, scope: Scope) {
    if (!node) return;
    if (node.type === 'Identifier') scope.names.add(node.name);
    else if (node.type === 'ObjectPattern') node.properties.forEach((p: any) => binding(p.value ?? p.argument, scope));
    else if (node.type === 'ArrayPattern') node.elements.forEach((p: any) => binding(p, scope));
    else if (node.type === 'AssignmentPattern') binding(node.left, scope);
    else if (node.type === 'RestElement') binding(node.argument, scope);
  }
  function collect(node: any, scope: Scope) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration') binding(node.id, scope);
    if (['Program', 'BlockStatement', 'CatchClause'].includes(node.type) || /Function/.test(node.type)) scope = { names: new Set(), parent: scope };
    scopes.set(node, scope);
    if (/Function/.test(node.type)) { binding(node.id, scope); node.params?.forEach((p: any) => binding(p, scope)); }
    if (node.type === 'VariableDeclarator') binding(node.id, scope);
    if (node.type === 'CatchClause') binding(node.param, scope);
    if (node.type?.startsWith('Import') && node.local) binding(node.local, scope);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(value => collect(value, scope));
      else if (child && typeof child === 'object') collect(child, scope);
    }
  }
  collect(ast, { names: new Set() });
  function declared(node: any) {
    let scope = scopes.get(node);
    while (scope) { if (scope.names.has(node.name)) return true; scope = scope.parent; }
    return false;
  }
  walk(ast, (node, parent, key) => {
    if (['ThisExpression', 'MetaProperty', 'ImportExpression', 'NewExpression', 'ClassDeclaration', 'ClassExpression', 'WithStatement', 'AwaitExpression', 'YieldExpression', 'SpreadElement'].includes(node.type) || node.async || node.generator) fail('STATIC_FORBIDDEN_CAPABILITY', '无法证明动态执行、对象构造或异步能力符合 Runtime 契约。');
    if ((node.type === 'Literal' && node.regex && /[gy]/.test(node.regex.flags)) || (node.type === 'UnaryExpression' && node.operator === 'delete')) fail('STATIC_NONDETERMINISTIC_API', '禁止正则游标或删除属性产生跨帧状态。');
    if (node.type === 'Identifier') {
      if (nondeterministic.has(node.name)) fail('STATIC_NONDETERMINISTIC_API', `禁止非确定性能力 ${node.name}。`);
      if (forbidden.has(node.name) || keys.has(node.name) || /^on[A-Z]/.test(node.name)) fail('STATIC_FORBIDDEN_CAPABILITY', `禁止项目访问 ${node.name}。`);
      const propertyName = (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
        (['Property', 'MethodDefinition'].includes(parent?.type) && key === 'key' && !parent.computed) ||
        (parent?.type === 'ImportSpecifier' && key === 'imported') || (parent?.type === 'ExportSpecifier' && key === 'exported');
      if (!propertyName && !declared(node) && !globals.has(node.name)) fail('STATIC_FORBIDDEN_CAPABILITY', `未声明的能力 ${node.name}。`);
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
      if (keys.has(node.value) || /^(?:script|iframe|object|embed|link|style|base|meta)$/i.test(node.value) || /^on[A-Z]/.test(node.value) || /(?:javascript:|https?:|file:|data:|url\s*\(|@import)/i.test(node.value)) fail('STATIC_FORBIDDEN_CAPABILITY', '禁止可执行标签、外部地址或动态 CSS 资源。');
    }
    if ((node.type === 'MemberExpression' || node.type === 'Property') && node.computed && (node.property ?? node.key)?.type !== 'Literal') fail('STATIC_FORBIDDEN_CAPABILITY', '动态属性访问无法证明合规。');
    if (node.type === 'MemberExpression' && node.object?.name === 'Math' && node.property?.name === 'random') fail('STATIC_NONDETERMINISTIC_API', '随机必须使用 Runtime 的显式种子 random。');
    if (node.type === 'VariableDeclaration' && node.kind !== 'const') fail('STATIC_NONDETERMINISTIC_API', '可变绑定可能跨帧保留状态，请使用纯函数。');
    if (node.type === 'Identifier' && node.name === 'Math' && !(parent?.type === 'MemberExpression' && key === 'object' && !parent.computed && parent.property.name !== 'random')) fail('STATIC_NONDETERMINISTIC_API', 'Math 只能直接读取确定性成员。');
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      fail('STATIC_NONDETERMINISTIC_API', '赋值可能改变跨帧状态，请使用纯函数。');
    }
    if (node.type === 'ImportDeclaration') {
      const specifier = node.source.value;
      if (specifier.startsWith('.') && !specifier.includes('..')) return;
      if (allowedImports[specifier]) {
        if (node.specifiers.some((s: any) => s.type !== 'ImportSpecifier' || !allowedImports[specifier].has(s.imported.name))) fail('STATIC_FORBIDDEN_CAPABILITY', `只允许 ${specifier} 的显式纯能力导入。`);
      } else if (['react-dom', '@remotion/player', 'scheduler'].includes(specifier)) fail('STATIC_FORBIDDEN_CAPABILITY', '禁止直接导入 Runtime 实现。');
      else if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(specifier)) fail('STATIC_FORBIDDEN_CAPABILITY', '不允许宿主模块、子路径或动态模块来源。');
    }
    if ((node.type === 'ExportNamedDeclaration' && node.source) || node.type === 'ExportAllDeclaration') fail('STATIC_FORBIDDEN_CAPABILITY', '请显式导入经过检查的能力，禁止转导出。');
  });
}
