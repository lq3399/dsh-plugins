# dsh-plugins

[DSH](https://github.com/deepseek-ai)（DeepSeek Harness）插件集合。

每个插件占一层**顶层目录**，目录名即插件包名，源码直接放在该目录下
（不是 monorepo 的 `packages/*`，而是「一层目录 = 一个可独立安装的包」）。

```
dsh-plugins/
└── dsh-model-label/          ← 一个插件 = 一层目录，包名即目录名
    ├── package.json
    ├── index.js              ← Host 半身
    ├── client.js             ← 浏览器半身
    ├── cordis.patch.yml      ← bundle patch
    ├── README.md
    └── _*-check.cjs          ← 自带验证脚本
```

## 插件列表

| 目录 | 说明 |
|---|---|
| [`dsh-model-label`](./dsh-model-label) | 把输入框右下角的模型位显示成 `{供应商名称}/{模型名称} · {思考强度}`，并把模型列表改成按供应商折叠的树。 |

## 安装

从本仓库安装某个插件，用 pnpm 的 `path:` 参数指定子目录（**注意 `#` 前是仓库、
`path:` 指向顶层目录**）：

```bash
# 在 profile 目录里执行（默认 ~/.dsh/profiles/desktop）
pnpm add github:lq3399/dsh-plugins#path:/dsh-model-label
```

也可以钉住分支或提交：

```bash
pnpm add github:lq3399/dsh-plugins#main&path:/dsh-model-label
pnpm add github:lq3399/dsh-plugins#<commit-sha>&path:/dsh-model-label
```

再把包名加进该 profile `package.json` 的 `dsh.profile.bundles`，或在
「设置 → 插件」里启用。**改动 bundle 列表需要重载窗口**（Loader 树是启动时组装的）。

改代码时要即时生效，就克隆后本地 link：

```bash
git clone https://github.com/lq3399/dsh-plugins.git
cd ~/.dsh/profiles/desktop
pnpm add link:/path/to/dsh-plugins/dsh-model-label
```

## 新增一个插件

1. 在本仓库根目录建一层以包名命名的目录，把源码放进去（`package.json` 的
   `name` 必须与目录名一致）。
2. 插件自带的 `README.md` 写清作用、原理与验证方式。
3. 在根 README 的插件列表里加一行。

## 约定

- **不用工作区**：各插件之间没有依赖关系，每层目录都是一个可独立
  `pnpm add` 的完整包，因此本仓库没有 `pnpm-workspace.yaml`。
- **不改官方包**：插件通过 Slot 遮蔽（`priority` 抢占 `single` cell）生效，
  升级 DSH 不会冲突。
- **自带验证**：每个插件的检查脚本放在自己目录下，`npm test` 即可运行。
