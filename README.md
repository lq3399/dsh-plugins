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

用 DSH 自带的插件命令从本仓库装某个插件，用 pnpm 的 `path:` 参数指定子目录
（**注意 `#` 前是仓库、`path:` 指向顶层目录**）：

```bash
dsh plugin --profile desktop add "github:lq3399/dsh-plugins#path:/dsh-model-label"
```

本仓库不是 monorepo（没有 `pnpm-workspace.yaml`），所以 `path:` 是**必需**的 ——
少了它 pnpm 会去找仓库根，而根上没有 `package.json`。

**spec 一定要加引号。** `&` 在 PowerShell、cmd 和 bash 里都是控制字符：不加引号
会被 shell 从 `&` 处截成两条命令，安装静默地只装到一半。

也可以钉住分支或提交：

```bash
dsh plugin --profile desktop add "github:lq3399/dsh-plugins#main&path:/dsh-model-label"
dsh plugin --profile desktop add "github:lq3399/dsh-plugins#<commit-sha>&path:/dsh-model-label"
```

安装命令会自动把包名写进该 profile `package.json` 的 `dependencies`，并因为插件声明了
`dsh.bundle.patch` 而把它追加进 `dsh.profile.bundles`。bundle 列表的变动由管理器热应用，
刷新窗口即可看到效果。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-model-label
```

`dependencies` 里的条目和 `dsh.profile.bundles` 里的那一行会一并移除。

## 本地开发

改代码时要即时生效，就克隆后本地 link（`link:` 建符号链接，改完刷新页面即可）：

```bash
git clone https://github.com/lq3399/dsh-plugins.git
dsh plugin --profile desktop add "link:/path/to/dsh-plugins/dsh-model-label"
```

本地路径必须是**绝对路径**，且只能走 `link:` / `file:` 前缀（官方安装解析器拒绝
相对路径）。开发期用 `link:` 而不是 `file:` —— 后者会把目录硬链接进 store，改源码
不即时反映。

## 新增一个插件

1. 在本仓库根目录建一层以包名命名的目录，把源码放进去（`package.json` 的
   `name` 必须与目录名一致）。
2. 插件自带的 `README.md` 写清作用、原理与验证方式。
3. 在根 README 的插件列表里加一行。

## 约定

- **不用工作区**：各插件之间没有依赖关系，每层目录都是一个可独立安装的完整包，
  因此本仓库没有 `pnpm-workspace.yaml`（安装时用 `path:` 指定子目录）。
- **不改官方包**：插件通过 Slot 遮蔽（`priority` 抢占 `single` cell）生效，
  升级 DSH 不会冲突。
- **自带验证**：每个插件的检查脚本放在自己目录下，`npm test` 即可运行。
