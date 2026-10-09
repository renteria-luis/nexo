import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { runInThisContext } from 'node:vm';

import ts from 'typescript';

type Node = { type: unknown; props: Record<string, any> };
type Slot = { value?: any; deps?: unknown[]; cleanup?: unknown };

// Execute the real component callbacks in the existing Node runner. Native views
// are inert leaves; no phone APIs or additional test dependencies are required.
export function renderModule(file: string, mocks: Record<string, any> = {}) {
  const instances = new Map<string, Slot[]>();
  let slots: Slot[] = [];
  let cursor = 0;
  let effects: (() => unknown)[] = [];
  const slot = () => slots[cursor++] ?? (slots[cursor - 1] = {});
  const changed = (a?: unknown[], b?: unknown[]) =>
    !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
  const react = {
    memo: (component: unknown) => component,
    createContext: (value: unknown) => ({ Provider: 'Provider', value }),
    useContext: (context: { value: unknown }) => context.value,
    useState: (initial: any) => {
      const state = slot();
      if (!('value' in state)) state.value = typeof initial === 'function' ? initial() : initial;
      return [
        state.value,
        (next: any) => {
          state.value = typeof next === 'function' ? next(state.value) : next;
        },
      ];
    },
    useRef: (value: unknown) => {
      const state = slot();
      return (state.value ??= { current: value });
    },
    useMemo: (make: () => unknown, deps: unknown[]) => {
      const state = slot();
      if (changed(state.deps, deps)) state.value = make();
      state.deps = deps;
      return state.value;
    },
    useCallback: (callback: unknown, deps: unknown[]) => react.useMemo(() => callback, deps),
    useEffect: (effect: () => unknown, deps: unknown[]) => {
      const state = slot();
      // Like React, the previous run's cleanup goes first when the dependencies change.
      if (changed(state.deps, deps)) {
        effects.push(() => {
          if (typeof state.cleanup === 'function') state.cleanup();
          state.cleanup = effect();
        });
      }
      state.deps = deps;
    },
  };
  const native = {
    Text: 'Text',
    View: 'View',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Keyboard: { dismiss() {} },
    StyleSheet: { create: (value: unknown) => value },
    AppState: { addEventListener: () => ({ remove() {} }) },
    Platform: { OS: 'web' },
    useWindowDimensions: () => ({ width: 400, height: 800 }),
    Animated: {
      View: 'Animated.View',
      Value: class {
        value: number;
        constructor(value: number) {
          this.value = value;
        }
        setValue(value: number) {
          this.value = value;
        }
      },
    },
    PanResponder: { create: () => ({ panHandlers: {} }) },
  };
  const modules = new Map<string, { exports: Record<string, any> }>();
  const load = (path: string): Record<string, any> => {
    const cached = modules.get(path);
    if (cached) return cached.exports;
    const require = createRequire(path);
    const source = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const module = { exports: {} as Record<string, any> };
    modules.set(path, module);
    runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: path })(
      (name: string) =>
        mocks[name] ??
        (name === 'react'
          ? react
          : name === 'react-native'
            ? native
            : name.startsWith('.') && /\.tsx?$/.test(name)
              ? load(resolve(dirname(path), name))
              : require(name)),
      module,
      module.exports,
    );
    return module.exports;
  };
  const exports = load(resolve(file));

  const expand = (node: any, path: string): any => {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}.${index}`));
    if (!node || typeof node !== 'object' || !('props' in node)) return node;
    if (typeof node.type === 'function') {
      slots = instances.get(path) ?? [];
      instances.set(path, slots);
      cursor = 0;
      return expand(node.type(node.props), `${path}.render`);
    }
    return {
      ...node,
      props: { ...node.props, children: expand(node.props.children, `${path}.children`) },
    };
  };
  return {
    mount(name: string, props: Record<string, any> = {}) {
      const render = () => {
        const tree = expand({ type: exports[name], props }, 'root');
        const pending = effects;
        effects = [];
        pending.forEach((effect) => effect());
        return tree;
      };
      return {
        render,
        async settle() {
          let tree: any;
          for (let i = 0; i < 10; i += 1) {
            tree = render();
            await Promise.resolve();
          }
          return tree;
        },
      };
    },
  };
}

export function nodes(tree: any): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}

export function textOf(tree: any): string {
  if (Array.isArray(tree)) return tree.map(textOf).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? textOf(tree.props?.children) : String(tree);
}
