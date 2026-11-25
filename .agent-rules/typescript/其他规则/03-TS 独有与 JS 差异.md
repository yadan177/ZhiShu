# 03 - TypeScript 独有与 JS 差异

> - 🟢 本文件适用于 TypeScript 独有的语法规范（类型注解/比较运算/装饰器等）。
> - 🔴 不适用：业务逻辑实现、UI 样式设计

---

## 1. 🔴 硬约束 · 这些绝对不要写

### 1.1 保留 JS 的隐式风险

```ts
// ❌ == 隐式转换
if (count == '5') { /* 类型不一致仍 true */ }

// ❌ arguments(deopt + 类型难)
function sum() {
  return Array.prototype.reduce.call(arguments, (a, b) => a + b, 0);
}

// ❌ with / eval(运行时禁用)
with (obj) { name = 'a'; }
eval('name = "a"');

// ❌ 全局变量污染
name = 'alice';                                     // 隐式全局

// ✅ === / rest / 显式声明
if (count === 5) { /* ... */ }
function sum(...nums: number[]) { return nums.reduce((a, b) => a + b, 0); }
```

### 1.2 没有类型注解

```ts
// ❌ 完全依赖推断(库代码不可用)
export function getUser(id) { /* ... */ }

// ✅ 函数参数 / 返回类型必加
export function getUser(id: number): Promise<User | null> { /* ... */ }
```

**规则**：

| 场景 | 是否必加类型 |
|------|------------|
| 库 / 公共 API | ✅ 显式参数 + 返回类型 |
| 业务函数参数 | ✅ 显式参数类型（返回可推断） |
| 业务函数返回 | 🟡 可推断；长函数 / 公共方法显式 |
| 内部局部变量 | ❌ 依赖推断 |

### 1.3 any 替代 unknown

```ts
// ❌ any 关闭类型检查
function parse(input: any): User { return JSON.parse(input); }

// ✅ unknown + 运行时守卫
function parse(input: unknown): User {
  if (typeof input !== 'string') throw new Error('Expected string');
  const value: unknown = JSON.parse(input);
  if (!isUser(value)) throw new Error('Invalid user payload');
  return value;
}
```

详见 [02-类型守卫与收窄](./02-类型守卫与收窄.md) §1.1、§1.3。

### 1.4 对象 / 数组类型用 any

```ts
// ❌
const config: any = {};
const items: any[] = [];

// ✅ interface / Record
interface Config { apiUrl: string; timeout: number; }
const config: Config = { apiUrl: '...', timeout: 5000 };

// ✅ 数组泛型
const items: User[] = [];
const items: Array<User> = [];
const items: readonly User[] = Object.freeze([]);    // 不变
```

### 1.5 函数 this 丢失

```ts
// ❌ this 类型隐式 any
class Counter {
  count = 0;
  increment() {
    setTimeout(function () {
      this.count++;                                   // ❌ this 是 undefined
    }, 1000);
  }
}

// ✅ 箭头函数(继承外层 this)
increment() {
  setTimeout(() => {
    this.count++;                                    // ✅
  }, 1000);
}

// ✅ TS 显式声明 this 类型
interface CounterThis { count: number }
function increment(this: CounterThis) {
  this.count++;
}
```

### 1.6 async / await 错误处理

```ts
// ❌ Promise 未指定泛型且未校验响应体
async function getUser(id) {                        // Promise<any>
  return await fetch(`/api/users/${id}`).then(r => r.json());
}

// ✅ 显式返回类型 + 响应体按 unknown 运行时校验 + catch 保留 cause
async function getUser(id: number): Promise<User> {
  try {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: unknown = await res.json();
    if (!isUser(data)) throw new Error('Invalid user response');
    return data;
  } catch (e: unknown) {
    if (e instanceof Error) throw e;
    throw new Error('Unknown error', { cause: e });
  }
}
```

### 1.7 import 不区分类型和值

```ts
// ❌ 混用类型与值导入（单文件转译器或类型剥离模式下难以静态区分，也容易造成副作用导入语义不明确）
import { User, getUser } from './user';

// ✅ 类型导入显式使用 import type
import type { User } from './user';
import { getUser } from './user';

// ✅ 或使用内联 type 修饰符（TS 4.5+）
import { type User, getUser } from './user';
```

注：常规 `tsc` 会自动擦除仅在类型位置使用的导入，但 esbuild/SWC/Babel 等单文件转译器以及 Node 原生类型剥离依赖显式 `type` 标记才能可靠擦除。若项目使用 TS 5.0+ 且团队决定统一约束，可在 `tsconfig.json` 中按需评估开启 `verbatimModuleSyntax`（注意它与部分 CJS 写法存在迁移成本，不作为所有存量项目的强制默认）：

```jsonc
{
  "compilerOptions": {
    "verbatimModuleSyntax": true,                     // 按需启用：强制显式 type 导入
    "isolatedModules": true
  }
}
```

## 2. 🟡 推荐 · 团队约定

### 2.1 const 断言与字面量

```ts
// ❌ 反复声明字面量类型
const STATUS: { Pending: 'pending'; Done: 'done' } = { Pending: 'pending', Done: 'done' };

// ✅ as const 一次搞定
const STATUS = { Pending: 'pending', Done: 'done' } as const;
type Status = (typeof STATUS)[keyof typeof STATUS]; // 'pending' | 'done'
```

### 2.2 命名空间 vs ESM

**现代 TS 业务代码用 ESM**，`declare namespace` 仅用于 `.d.ts` 环境声明或类型声明合并：

```ts
// ✅ 仅在 .d.ts / 环境声明中用 declare namespace 描述外部契约或类型合并
declare namespace MyLib {
  export interface Config {
    timeout: number;
  }
  export function setup(c: Config): void;
}

// ❌ 业务源码中用 namespace 装运行时代码（会生成运行时 IIFE，且不兼容 erasableSyntaxOnly；应改用 ES module）
namespace MyLibRuntime {
  export const VERSION = '1.0.0';
}
```

### 2.3 declare / ambient

**全局扩展**：

```ts
// src/types/global.d.ts
declare global {
  interface Window {
    myApp?: { version: string };
  }
  namespace NodeJS {
    interface ProcessEnv {
      // 运行时环境变量可能缺失，应标为可选并在启动边界校验
      DATABASE_URL?: string;
      NODE_ENV?: 'development' | 'production' | 'test';
    }
  }
}
export {};                                           // 标记为模块
```

**模块声明**：

```ts
// src/types/css-modules.d.ts
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
```

### 2.4 标准装饰器与 legacy decorators

- 🔴 先检查 TypeScript 版本、`experimentalDecorators`、框架编译链和现有装饰器签名；标准装饰器与 legacy decorators 的类型和运行时语义不同，不能机械迁移。
- 🟡 TypeScript 5.0+ 支持标准装饰器语法，但具体能力仍受 target、lib、emit 和框架约束；使用下面的标准方法装饰器签名时不得套用 legacy 的 descriptor 参数。

```ts
function loggedMethod<This, Args extends unknown[], Result>(
  originalMethod: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<
    This,
    (this: This, ...args: Args) => Result
  >,
) {
  return function (this: This, ...args: Args): Result {
    console.log(`Calling ${String(context.name)}`);
    return originalMethod.call(this, ...args);
  };
}

class Calculator {
  @loggedMethod
  add(a: number, b: number) { return a + b; }
}
```

- 🟡 项目因 Angular、NestJS、ORM、metadata 或既有库继续使用 legacy decorators 时，沿用其锁定版本与配置；迁移需要单独授权和回归计划。

### 2.5 默认导出 vs 具名导出

**具名优先**（与 [01-代码编写规则](../../javascript/其他规则/01-代码编写规则.md) §1.2、§1.7 一致）：

```ts
// ✅ 具名导出类型与函数
export interface User {
  id: number;
  name: string;
}
export function getUser(id: number): Promise<User | null> { /* ... */ }
export function deleteUser(id: number): Promise<void> { /* ... */ }

// ❌ 把多个函数打包成一个默认导出对象
export default { getUser, deleteUser };
```

### 2.6 函数重载（声明 + 实现）

```ts
// ✅ 声明多个签名
function process(input: string): string;
function process(input: number): number;
function process(input: string | number): string | number {
  return typeof input === 'string' ? input.trim() : input * 2;
}
```

## 3. 🟢 可选 · 视情况

### 3.1 Import Attributes（TS 5.3+）

TC39 已用 `with` 语法（Import Attributes）取代旧的 `assert`（Import Assertions）。仅在目标运行时、构建工具与 `tsconfig` 模块配置支持时使用：

```ts
// JSON module（Node / 现代浏览器与 bundler 支持）
import config from './config.json' with { type: 'json' };

// CSS Module Script（导入的是 CSSStyleSheet 实例，用于 adoptedStyleSheets；不等同于 bundler 的 *.module.css 类名映射）
import sheet from './theme.css' with { type: 'css' };
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
```

> 其他 TS 独有可选类型特性（`satisfies`、`const` 类型参数、模板字面量类型）见 [01-类型系统](./01-类型系统.md) §3。
