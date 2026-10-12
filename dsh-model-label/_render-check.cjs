/**
 * Real React + jsdom render check for dsh-model-label's tree picker.
 *
 * The headless check stubs React and therefore cannot observe a single state
 * transition. This harness mounts the real seat with react-dom/client, clicks
 * the real DOM, and asserts the folded-tree behaviour end to end:
 *
 *   - only the provider owning the selection starts open
 *   - clicking a provider toggles only that subtree
 *   - a search unfolds providers with matches
 *   - selecting a model reaches the shared directory with the right ids
 *   - the trigger still reads `{providerName}/{modelName} · {effort}`
 *
 * Run with any Node.js >= 18, after installing the dev-only peers once:
 *   npm install
 *   node _render-check.cjs
 */
const path = require('node:path')
const fs = require('node:fs')

// react / react-dom / jsdom are NOT plugin dependencies — the shell provides
// React at runtime. They are devDependencies of this repo, needed only by this
// check, so resolve them from this directory's local install.
const PEER_ROOTS = [__dirname]
const resolveModule = name => {
  for (const base of PEER_ROOTS) {
    try {
      return require.resolve(name, { paths: [base] })
    } catch {
      /* try the next root */
    }
  }
  throw new Error(`render check needs ${name}; install the devDependencies with: npm install`)
}

const { JSDOM } = require(resolveModule('jsdom'))

// ── a DOM before anything requires react-dom ────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
})
global.window = dom.window
global.document = dom.window.document
global.navigator = dom.window.navigator
global.HTMLElement = dom.window.HTMLElement
global.HTMLButtonElement = dom.window.HTMLButtonElement
global.HTMLInputElement = dom.window.HTMLInputElement
global.Element = dom.window.Element
global.Node = dom.window.Node
global.Event = dom.window.Event
global.MouseEvent = dom.window.MouseEvent
global.KeyboardEvent = dom.window.KeyboardEvent
global.IS_REACT_ACT_ENVIRONMENT = true

// jsdom implements no layout, so it ships no scrollIntoView; the seat (like the
// shipped picker) calls it to keep the highlighted row visible. Record every
// call: an unexpected one is exactly the "viewport jumped to the top" symptom,
// because it targets whatever row the seat believes is active.
const scrollCalls = []
dom.window.Element.prototype.scrollIntoView = function scrollIntoView() {
  scrollCalls.push({
    className: this.className,
    text: this.textContent,
  })
}
const takeScrollCalls = () => {
  const calls = scrollCalls.slice()
  scrollCalls.length = 0
  return calls
}

const React = require(resolveModule('react'))
const ReactDOM = require(resolveModule('react-dom/client'))
const { act } = require(resolveModule('react'))

// ── stub the platform primitives the bundle requires ────────────────────────
const primitives = new Proxy(
  {
    rankByName: (items, rawQuery) => {
      const q = String(rawQuery).toLowerCase()
      if (q === '') return items
      return items.filter(item => item.name.toLowerCase().includes(q))
    },
    // A real input so the search box can actually be typed into.
    Input: React.forwardRef(function Input(props, ref) {
      return React.createElement('input', { ...props, ref })
    }),
  },
  {
    get: (target, prop) => {
      if (prop in target) return target[prop]
      // Icon / layout stubs: render a marker element carrying the props through.
      // forwardRef because the seat refs MenuSurface and Input.
      return React.forwardRef(function Stub(props, ref) {
        const { children, ...rest } = props ?? {}
        return React.createElement('span', { ref, 'data-stub': String(prop), ...rest }, children ?? null)
      })
    },
  },
)

const platformModules = {
  react: React,
  'react/jsx-runtime': { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment },
  'react-dom': require(resolveModule('react-dom')),
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
}

// ── load the bundle exactly as the ModuleLoader would ───────────────────────
const source = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8')

let loaded = null
// The bundle reads `window` (the global) inside its factory, so the loader
// handle must live on the very same object the seat sees.
dom.window.__ModuleLoader__ = { load: spec => (loaded = spec) }
new Function('window', 'require', source)(dom.window, spec => {
  if (spec in platformModules) return platformModules[spec]
  throw new Error(`unexpected require("${spec}")`)
})
const exportsObj = loaded.factory(spec => {
  if (spec in platformModules) return platformModules[spec]
  throw new Error(`unexpected factory require("${spec}")`)
})

// ── catalog: two providers, the selection living in the SECOND one ──────────
const state = {
  current: { provider: 'volcengine', model: 'glm-5.3', reasoningEffort: 'high' },
  routable: true,
  groups: [
    {
      id: 'deepseek-account',
      name: 'DeepSeek Account',
      models: [
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
        { id: 'deepseek-v4.1', name: 'DeepSeek V4.1' },
      ],
    },
    {
      id: 'volcengine',
      name: '火山方舟',
      models: [
        { id: 'glm-5.3', name: 'GLM 5.3', reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
        { id: 'kimi-k2', name: 'Kimi K2' },
      ],
    },
    { id: 'openrouter', name: 'OpenRouter', models: [{ id: 'qwen3-max', name: 'Qwen3 Max' }] },
  ],
  failures: [],
  status: 'ready',
  pending: null,
  error: null,
  retainedEffort: 'High',
}
const store = { getSnapshot: () => state, subscribe: () => () => {} }

const selections = []
let registered = null
const fakeCtx = {
  effect: fn => {
    const d = fn()
    return typeof d === 'function' ? d : () => {}
  },
  inject: (services, cb) =>
    cb({
      slots: {
        inject: (slot, register) => register(),
        register: (meta, component) => {
          registered = { meta, component }
          return () => {}
        },
      },
      modelDirectories: {
        directoryFor: () => ({
          store,
          load: async () => state,
          select: async selection => {
            selections.push(selection)
            return { ok: true }
          },
        }),
      },
      sessions: { subagentAddress: () => undefined },
    }),
  get: () => undefined,
  locale: { register: () => () => {}, bind: () => key => key },
}
exportsObj.apply(fakeCtx)

const t = (key, params) => {
  const template = DICT[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
}

// The plugin's own Chinese dictionary, read back out of the bundle so this
// harness never drifts from the shipped strings.
const DICT = (() => {
  const match = source.match(/const DICT = \{[\s\S]*?\n    \}/)
  if (match === null) throw new Error('could not read DICT out of the bundle')
  // eslint-disable-next-line no-new-func
  return new Function(`${match[0]}\nreturn DICT`)().zh
})()
const face = registered.meta.inject('session-1')

// ── mount ───────────────────────────────────────────────────────────────────
const host = document.getElementById('host')
let root = null
act(() => {
  root = ReactDOM.createRoot(host)
  root.render(React.createElement(registered.component, { locked: false, t, ...face }))
})

const results = []
const check = (label, ok, detail = '') => results.push({ label, ok, detail })

const trigger = () => document.querySelector('.dml_trigger')
const menu = () => document.querySelector('.dml_menu')
const providerToggles = () => [...document.querySelectorAll('.dml_providerToggle')]
const providerLabels = () => providerToggles().map(node => node.querySelector('.dml_providerName').textContent)
const expandedProviders = () =>
  providerToggles()
    .filter(node => node.getAttribute('aria-expanded') === 'true')
    .map(node => node.querySelector('.dml_providerName').textContent)
const modelRows = () => [...document.querySelectorAll('.dml_option.dml_modelRow')]
const modelNames = () => modelRows().map(node => node.querySelector('.dml_modelName').textContent)

const click = node =>
  act(() => {
    node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })

// Open the seat and drill from the root pane into the model pane. With a
// selection already saved the seat opens on `root`, exactly like the shipped one.
const openModelPane = () => {
  click(trigger())
  const modelCell = [...document.querySelectorAll('.dml_cell')].find(n =>
    n.textContent.includes(DICT['menu.model']),
  )
  if (modelCell !== undefined && modelCell !== null) click(modelCell)
}

check('trigger renders the provider-qualified label', trigger().textContent.includes('火山方舟/GLM 5.3'), trigger().textContent)
openModelPane()
check('menu opens on the model pane', menu() !== null && providerToggles().length > 0)

// ── default fold state ──────────────────────────────────────────────────────
check(
  'lists every provider as a toggle',
  JSON.stringify(providerLabels()) === JSON.stringify(['DeepSeek 账号', '火山方舟', 'OpenRouter']),
  JSON.stringify(providerLabels()),
)
check(
  'only the provider owning the selection starts open',
  JSON.stringify(expandedProviders()) === JSON.stringify(['火山方舟']),
  JSON.stringify(expandedProviders()),
)
check(
  'a folded provider contributes no model rows',
  JSON.stringify(modelNames()) === JSON.stringify(['GLM 5.3', 'Kimi K2']),
  JSON.stringify(modelNames()),
)
check(
  'every provider toggle reports its model count',
  providerToggles()[0].querySelector('.dml_providerMeta').textContent ===
    t('provider.count', { count: 2 }),
  providerToggles()[0].querySelector('.dml_providerMeta').textContent,
)
check(
  'the selected model row is marked checked',
  modelRows().some(n => n.getAttribute('aria-checked') === 'true' && n.textContent.includes('GLM 5.3')),
)

// ── opening a second provider does not close the first ──────────────────────
click(providerToggles()[0])
check(
  'opening another provider keeps the selection provider open',
  JSON.stringify(expandedProviders()) === JSON.stringify(['DeepSeek 账号', '火山方舟']),
  JSON.stringify(expandedProviders()),
)
check(
  'the newly opened subtree shows its models',
  modelNames().includes('DeepSeek V4.1 Flash'),
  JSON.stringify(modelNames()),
)

// ── folding the selection's provider ────────────────────────────────────────
click(providerToggles()[1])
check(
  'clicking a provider folds exactly that subtree',
  JSON.stringify(expandedProviders()) === JSON.stringify(['DeepSeek 账号']),
  JSON.stringify(expandedProviders()),
)
check(
  'the folded subtree removes its model rows',
  !modelNames().includes('GLM 5.3'),
  JSON.stringify(modelNames()),
)

// ── folding must not scroll the viewport ────────────────────────────────────
//
// The reported bug: toggling a provider snapped the scrollbar back to the top,
// so the user had to scroll down again to see what they had just unfolded. The
// cause was the "keep the active row visible" effect re-running on every fold
// and scrolling to the stale active row — row 0, once the selection's own
// provider was the one folded away.
//
// This block remounts so it starts from a clean pane, then asserts that no
// toggle scrolls. Opening the pane may scroll once (revealing the selection);
// every toggle after that must produce no scroll at all.
{
  state.current = { provider: 'volcengine', model: 'glm-5.3', reasoningEffort: 'high' }
  act(() => {
    root.unmount()
  })
  act(() => {
    root = ReactDOM.createRoot(host)
    root.render(React.createElement(registered.component, { locked: false, t, ...face }))
  })
  openModelPane()
  takeScrollCalls()

  click(providerToggles()[0])
  const afterUnfold = takeScrollCalls()
  check(
    'unfolding a provider does not scroll the viewport',
    afterUnfold.length === 0,
    JSON.stringify(afterUnfold),
  )

  click(providerToggles()[1])
  const afterFold = takeScrollCalls()
  check(
    'folding the selection provider does not scroll the viewport',
    afterFold.length === 0,
    JSON.stringify(afterFold),
  )

  click(providerToggles()[1])
  const afterReUnfold = takeScrollCalls()
  check(
    're-unfolding a provider does not scroll the viewport',
    afterReUnfold.length === 0,
    JSON.stringify(afterReUnfold),
  )
}

// ── selection still works through the tree ──────────────────────────────────
const deepseekModel = modelRows().find(n => n.textContent.includes('DeepSeek V4.1 Flash'))
click(deepseekModel)
check(
  'choosing a model writes the provider/model pair to the directory',
  selections.length === 1 &&
    selections[0].provider === 'deepseek-account' &&
    selections[0].model === 'deepseek-v4.1-flash',
  JSON.stringify(selections),
)

// ── search unfolds matches ──────────────────────────────────────────────────
state.current = { provider: 'volcengine', model: 'glm-5.3', reasoningEffort: 'high' }
selections.length = 0
act(() => {
  root.unmount()
})
act(() => {
  root = ReactDOM.createRoot(host)
  root.render(React.createElement(registered.component, { locked: false, t, ...face }))
})
openModelPane()
const search = document.querySelector('.dml_search input') ?? document.querySelector('.dml_search')
check('search box is present', search !== null)
takeScrollCalls()
act(() => {
  const input = document.querySelector('input[role="searchbox"]')
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(input, 'qwen')
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
check(
  'a search unfolds the provider holding the match',
  expandedProviders().includes('OpenRouter'),
  JSON.stringify(expandedProviders()),
)
check('the match is visible', modelNames().includes('Qwen3 Max'), JSON.stringify(modelNames()))
check(
  'providers without a match are dropped entirely',
  !providerLabels().includes('火山方舟'),
  JSON.stringify(providerLabels()),
)
// The fold fix must not cost the reveal behaviour: a query still scrolls to its
// result, otherwise a match below the fold would stay invisible.
{
  const afterQuery = takeScrollCalls()
  check(
    'typing a query still reveals the matching row',
    afterQuery.some(call => String(call.text).includes('Qwen3 Max')),
    JSON.stringify(afterQuery),
  )
}

// ── report ──────────────────────────────────────────────────────────────────
let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.ok ? '' : `  [${r.detail}]`}`)
}
console.log(`\n${results.length - failed}/${results.length} render checks passed`)
process.exit(failed === 0 ? 0 : 1)
