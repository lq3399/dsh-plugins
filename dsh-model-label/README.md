# dsh-model-label

把 DSH Web GUI 输入框右下角的模型选择器显示成 `{供应商名称}/{模型名称} · {思考强度}`，
并把模型列表改成**按供应商折叠的树**。

## 效果

| | 显示 |
|---|---|
| 原版 | `DeepSeek V4.1 Flash · 高` |
| 本插件 | `火山方舟/DeepSeek V4.1 Flash · 高` |

用的是**显示名称**（catalog 里的 `name`），不是标识符。

唯一的例外：当保存的选择在目录里已经不存在（供应商被删、模型下线、账号登出），
显示名无从取得，此时才回退成 `volcengine/deepseek-v4.1-flash` 这样的 id ——
否则你无法知道当前存的是什么。绝不会出现 `undefined/undefined`。

`deepseek-account` 这个供应商按官方惯例显示为本地化的「DeepSeek 账号」。

## 模型列表：按供应商折叠的树

模型面板是一棵树，每个供应商一行可点击的折叠标题，模型嵌在它下面：

```
▾ 火山方舟                     2 个模型
    GLM 5.3                  ✓
    Kimi K2
▸ DeepSeek 账号                2 个模型
▸ OpenRouter                   1 个模型
```

折叠规则只有三条：

1. **默认只展开当前选中模型所在的供应商**，其余全部折叠 —— 打开菜单第一眼
   就看到自己现在用的是什么，不用滚动。还没选过模型时展开第一个。
2. **点标题就是开/关**，每个供应商的折叠状态互相独立，展开第二个不会收起第一个。
3. **一搜索就全部展开**（只展开有命中的供应商），否则命中的模型藏在折叠里等于没搜到。

用户手动开合过的供应商会记住这次选择；没动过的继续跟着当前选择走。
所以选择在别处（`/model` 弹窗、切换会话、目录刷新）变化时，树会自动跟着变，
不需要额外的同步逻辑。

键盘操作相应扩展：`↑↓` 在所有可见行（含供应商标题）之间移动，
`Enter` 落在标题上就开合、落在模型上就选中。

### 开合时不会把滚动条弹回顶部

「保持当前行可见」的 effect 不能以**行列表**为依赖。折叠会重写行列表，
而一旦选中模型所在的供应商被折叠，那个「当前行」就从列表里消失了 ——
下标回落成 `0`，于是每次开合都把视口滚回顶部，用户还得重新往下拖才能看到
展开结果。

所以这个 effect 用的是一个**不含行列表**的签名（`open|pane|query|highlight`）：
折叠改变的是列表内容，从来不是「需要滚动」的理由。键盘高亮真正移动时、
切换面板或改搜索词时才滚动，并且优先滚到模型行而不是供应商标题 ——
否则被展开出来的匹配项恰好落在折叠线下面。

`_render-check.cjs` 里用记录 `scrollIntoView` 调用的方式守住了这条：
开合必须产生 **0 次**滚动，而输入搜索词仍必须产生滚动。

## 原理：遮蔽单个 Slot

输入框的模型位是 `conversation.input.model`，类型是 `single`。
`single` 的规则是 **按 `priority` 升序排列，第一个注册项独占这个位置**
（见 `dsh-client-ui-slots` 的 `entriesOfSlot`：按 priority 排序，
渲染器取 `entriesOfSlot(key)[0]`）。

所以本插件用 `priority: -100` 注册，就自然盖住官方那一项：

```
occupants:
  { registrant: "dsh-model-label", priority: -100, active: true  }   ← 本插件
  { registrant: "mf",             priority: 0,    active: false }   ← 官方选择器
```

官方包一行都不用改，升级 DSH 也不会冲突。

### 为什么没有复用原版的 `MenuGroup`

原版的供应商分组用的是 primitives 的 `MenuGroup`，但它不适合做折叠树：

- 它的标题是一个**不可点击**的 `div`，无法承担开合语义；
- 它给标题加 `position:sticky`，滚动时靠 `observeStickyMenuGroups` 计算背景。
  这个函数要求滚动容器的**每个直接子节点**都是 `MenuGroup`
  （`querySelectorAll(':scope > [data-menu-group]')`），折叠树把模型嵌在
  供应商节点内部，结构上就不再满足。

所以树行改成本插件自己的 `.dml_provider*` 样式，只借用 `MenuGroup` 标题的字号字重
（11px/500、`--dsw-alias-label-tertiary`），视觉上与原版一致。

### 必须声明 `remote.session`（重启后失效的根因）

`active` 表示「该注册项是否仍赢得这个 cell」
（`ui-slots` 的 `snapshot()`：`active: active.has(entry)`）。
如果组件抛错，条目会被 **弃用（abdicate）**，`active` 变成 `false`，
cell 自动回落到官方项 —— 表现就是「插件装了但没生效」。

本插件踩过这个坑，而且**只在重启/重新应用后暴露**：热加载时恰好没走到那条
渲染路径，看起来是好的，重启后才失效。真实错误是：

```
Error: cannot get property "remote.session" without inject
    at Proxy.directoryFor (dsh-model-label/client.js)
```

原因是 Cordis 的 **Service 代理会把 `this.ctx` 绑定到「调用方」的上下文**。
`modelDirectories.directoryFor()` 内部要读 `this.ctx.remote.session`，
而这个调用发生在本插件的上下文里 —— 所以本插件必须自己声明 `remote` 和
`remote.session`，光拿到服务对象是不够的：

```js
// ❌ 会抛 cannot get property "remote.session" without inject
const inject = ['slots', 'locale', 'sessions']

// ✅ 与官方 ui-model-selection 的声明一致
const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.session']
```

官方 `ui-model-selection` 的 `inject` 里同样有这一对，正是同一个原因。

**排查方法**：用 `cordis_inspect_query` 查 `conversation.input.model` 的
`occupants`，看 `active` 落在谁身上。若本插件是 `active: false`，说明它抛错被
弃用了 —— 这时临时注册一个 list slot，把 `ctx.slots.onEntryError` 捕获到的
堆栈写进它的 `id`，就能直接读出真实错误（比猜快得多）。

## 安装

本插件住在 [`lq3399/dsh-plugins`](https://github.com/lq3399/dsh-plugins) 仓库的
`dsh-model-label/` 目录里（每个插件一层顶层目录）。用 DSH 自带的插件命令从仓库装：

```bash
dsh plugin --profile desktop add "github:lq3399/dsh-plugins#path:/dsh-model-label"
```

`#path:/dsh-model-label` 是 pnpm 的子目录语法：`#` 前是仓库，`path:` 指向包所在的
顶层目录。本仓库不是 monorepo，没有 `pnpm-workspace.yaml`，所以这个 `path:` 是
**必需**的 —— 少了它 pnpm 会去找仓库根，而根上没有 `package.json`。

**spec 一定要加引号。** `&` 在 PowerShell、cmd 和 bash 里都是控制字符：不加引号
会被 shell 从 `&` 处截成两条命令，安装静默地只装到一半（PowerShell 里表现为
后台任务，cmd 里表现为「path:/... 不是内部或外部命令」）。

也可以钉住分支或提交：

```bash
dsh plugin --profile desktop add "github:lq3399/dsh-plugins#main&path:/dsh-model-label"
dsh plugin --profile desktop add "github:lq3399/dsh-plugins#<commit-sha>&path:/dsh-model-label"
```

`--profile desktop` 是必需的：桌面端 profile 由应用独占管理，`dsh` 会带上应用
自己的 pnpm 与授权去改它。安装完成后不用手工编辑任何配置 —— 命令会自动把
`dsh-model-label` 写进该 profile `package.json` 的 `dependencies`，并因为本包声明了
`dsh.bundle.patch` 而把它追加进 `dsh.profile.bundles`。bundle 列表的这次变动由管理器
热应用，刷新窗口即可看到效果（`client.js` 本身的改动在 HMR 监听下刷新页面即可）。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-model-label
```

`dependencies` 里的条目和 `dsh.profile.bundles` 里的那一行会一并移除。若窗口里
模型位仍显示旧样式，刷新页面即可。

## 本地开发

改代码要即时生效，就把工作副本 link 进 profile（`link:` 建符号链接，改完
`client.js` 刷新页面即可，不需要重装）：

```bash
git clone https://github.com/lq3399/dsh-plugins.git
dsh plugin --profile desktop add "link:/path/to/dsh-plugins/dsh-model-label"
```

本地路径必须是**绝对路径**，且只能走 `link:` / `file:` 前缀：官方安装解析器拒绝
相对路径（相对路径会相对 profile 目录解析，指向 profile 内部）。开发期用 `link:`
而不是 `file:` —— 后者会把目录硬链接进 store，改源码不即时反映。

## 保留了什么

除了触发器的标签文本和模型面板的树形结构，官方选择器的行为全部保留：

- 两级菜单（模型 / 推理等级）、模糊搜索
- 完整键盘操作（↑↓ / Enter / Tab / Esc / Shift+Tab）
- 切换中的 spinner、失败 toast、目录加载失败的 Retry 条
- 与 `/model` 弹窗共用同一个 per-session `ModelDirectory`，两边永远一致

菜单里每行只显示模型名，和原版一致。

## 依赖

只依赖 shell 已提供的静态模块：`react`、`react-dom`、
`@deepseek-ai/dsh-client-ui-primitives`（这三个都在 web 前端的
`PLATFORM_MODULES` 种子里）。不需要构建步骤，也不需要 `dsh.client.external`。

## 验证

```bash
npm install            # 只为测试装 jsdom / react / react-dom，插件本身零依赖
npm test               # 全部检查（37 + 冷启动 + 20）

# 也可以单独跑
node _headless-check.cjs      # 37 项：注册、priority、显示名与 id 回退、树的折叠
node _coldstart-check.cjs     # 冷启动依赖：inject 必须含 remote.session
node _render-check.cjs        # 20 项：真实 React + jsdom 点击驱动
```

`_headless-check.cjs` 覆盖：bundle 注册、`inject` 声明、`ctx.inject` 服务依赖、
只注册一个 slot、priority 为负（确保赢得 single cell）、组件可渲染、
触发器显示 `{供应商名}/{模型名}`、不出现 id、目录项缺失时回退到 id
且绝不渲染 `undefined`，以及树的折叠语义（默认只展开选中供应商、折叠的行不产生
模型行、开合互相独立、点击模型仍正确上报 provider/model）。

它的 React 桩是**有状态的**（`useState`/`useRef` 保留槽位、setter 触发重渲染），
所以能真正驱动折叠状态变化，而不是只观察首次渲染。

`_coldstart-check.cjs` 专门守住上面那个「重启后失效」的坑：断言 `inject` 里
确实有 `remote` / `remote.session`，并与官方 `ui-model-selection` 的必需项
逐项比对，同时检查没有残留的临时诊断代码。

`_render-check.cjs` 用真实 React + jsdom 挂载组件并派发真实 DOM 事件，
验证只有选中供应商默认展开、展开第二个不会收起第一个、点击折叠、搜索展开命中项、
点击模型真的以正确的 provider/model 调用了共享目录，以及**开合不产生任何滚动**
（记录 `scrollIntoView` 调用数；这条正是「开合后滚动条弹回顶部」的回归测试）。

## 文件

| 文件 | 作用 |
|---|---|
| `client.js` | 浏览器半身：遮蔽模型位，渲染 `{供应商名}/{模型名} · {effort}`，模型面板为按供应商折叠的树 |
| `index.js` | Host 半身：空实现（浏览器半身必须挂在同名 Loader 行上） |
| `cordis.patch.yml` | bundle patch：插入一行挂载 Host 半身 |
| `_headless-check.cjs` | 无头验证脚本（注册、标签、树的折叠语义） |
| `_coldstart-check.cjs` | 冷启动依赖验证（`remote.session`） |
| `_render-check.cjs` | 真实 React + jsdom 点击驱动（含「开合不滚动」回归测试） |
