/**
 * Headless check for dsh-model-label's client bundle.
 *
 * Verifies the bundle registers with the module loader, declares the right
 * injections, wires exactly one entry into `conversation.input.model` at the
 * shadowing priority, and renders `{provider}/{model} · {effort}` — without a
 * browser. Run with any Node.js >= 18:
 *
 *   node _headless-check.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const bundlePath = path.join(__dirname, 'client.js')
const source = fs.readFileSync(bundlePath, 'utf8')

// ── stub platform modules ────────────────────────────────────────────────────
//
// The React stub is deliberately STATEFUL: `useState`/`useRef` keep their slots
// and a setter re-renders the component, so this check can drive the tree's real
// fold transitions (a no-op stub could only ever observe the initial render).
// `useMemo`/`useCallback` are pass-throughs and consume no slot, which keeps the
// slot indices stable as long as the hook order is stable — true for this seat.
const hookSlots = []
let hookCursor = 0
let scheduleRender = () => {}

const resetHooks = () => {
  hookSlots.length = 0
  hookCursor = 0
}

const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  useState: initial => {
    const at = hookCursor++
    if (!(at in hookSlots)) hookSlots[at] = typeof initial === 'function' ? initial() : initial
    const set = next => {
      const value = typeof next === 'function' ? next(hookSlots[at]) : next
      if (Object.is(value, hookSlots[at])) return
      hookSlots[at] = value
      scheduleRender()
    }
    return [hookSlots[at], set]
  },
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: fn => fn(),
  useRef: initial => {
    const at = hookCursor++
    if (!(at in hookSlots)) hookSlots[at] = { current: initial }
    return hookSlots[at]
  },
  useCallback: fn => fn,
  useId: () => 'test-id',
  useSyncExternalStore: (sub, get) => get(),
}

const primitives = new Proxy(
  { rankByName: items => items },
  {
    get: (target, prop) => {
      if (prop in target) return target[prop]
      return function Stub() {
        return null
      }
    },
  },
)

const platformModules = {
  react,
  'react/jsx-runtime': { jsx: react.createElement, jsxs: react.createElement, Fragment: react.Fragment },
  // Pass the portalled children through so the menu is part of the tree this
  // check walks; a real DOM portal only changes where they are mounted.
  'react-dom': { createPortal: children => children },
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
}

let loaded = null
global.window = {
  __ModuleLoader__: {
    load: spec => {
      loaded = spec
    },
  },
}
global.document = { createElement: () => ({ setAttribute() {}, remove() {} }), head: { appendChild() {} } }

// ── run the bundle ───────────────────────────────────────────────────────────
const loadBundle = src => {
  loaded = null
  new Function('window', 'require', src)(global.window, spec => {
    if (spec in platformModules) return platformModules[spec]
    throw new Error(`unexpected require("${spec}")`)
  })
  return loaded
}

const requireFrom = spec => {
  if (spec in platformModules) return platformModules[spec]
  throw new Error(`unexpected factory require("${spec}")`)
}

loadBundle(source)
const exportsObj = loaded.factory(requireFrom)

const results = []
const check = (label, ok, detail = '') => results.push({ label, ok, detail })

check('bundle registers with the loader', loaded !== null)
check('bundle id', loaded?.id === 'dsh-model-label', String(loaded?.id))
check('exports.name', exportsObj.name === 'dsh-model-label', String(exportsObj.name))
check(
  'exports.inject declares slots + locale',
  Array.isArray(exportsObj.inject) && exportsObj.inject.includes('slots') && exportsObj.inject.includes('locale'),
  JSON.stringify(exportsObj.inject),
)
check('exports.apply is a function', typeof exportsObj.apply === 'function')

// ── a realistic directory snapshot: one provider group, one model ────────────
const directoryState = {
  current: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
  routable: true,
  groups: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-v4.1-flash',
          name: 'DeepSeek V4.1 Flash',
          reasoning: {
            defaultEffort: 'high',
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
          },
        },
      ],
    },
  ],
  failures: [],
  status: 'ready',
  pending: null,
  error: null,
  retainedEffort: 'High',
}
const directoryStore = { getSnapshot: () => directoryState, subscribe: () => () => {} }

// ── exercise apply() against a fake ctx ──────────────────────────────────────
let registered = null
const registrations = []
const directory = {
  store: directoryStore,
  load: async () => directoryState,
  select: async () => ({ ok: true }),
}
const fakeCtx = {
  effect: fn => {
    const d = fn()
    return typeof d === 'function' ? d : () => {}
  },
  // The registration rides ctx.inject([...services], scope => ...), the same
  // shape the shipped seat uses, so the scope is handed to us synchronously.
  inject: (services, cb) => {
    registrations.push({ services, cb })
    cb({
      slots: {
        inject: (slot, register) => registrations.push({ slot, register }),
        register: (meta, component) => {
          registered = { meta, component }
          return () => {}
        },
      },
      modelDirectories: { directoryFor: () => directory },
      sessions: { subagentAddress: () => undefined },
    })
  },
  get: () => undefined,
  locale: { register: () => () => {}, bind: () => key => key },
}

exportsObj.apply(fakeCtx)

check('injects the services the seat needs', registrations.length >= 1, `count=${registrations.length}`)
check(
  'inject declares slots + modelDirectories + sessions',
  Array.isArray(registrations[0]?.services) &&
    registrations[0].services.includes('slots') &&
    registrations[0].services.includes('modelDirectories') &&
    registrations[0].services.includes('sessions'),
  JSON.stringify(registrations[0]?.services),
)

const slotRegistration = registrations.find(r => r.slot === 'conversation.input.model')
check('registers into conversation.input.model', slotRegistration !== undefined, String(slotRegistration?.slot))
slotRegistration.register()

check('register meta.name', registered?.meta?.name === 'conversation.input.model', String(registered?.meta?.name))
check(
  'shadowing priority is negative (wins the single cell)',
  typeof registered?.meta?.priority === 'number' && registered.meta.priority < 0,
  String(registered?.meta?.priority),
)
check('register meta.locale', registered?.meta?.locale === 'dsh-model-label', String(registered?.meta?.locale))
check('register supplies an inject face', typeof registered?.meta?.inject === 'function')
check('register supplies a component', typeof registered?.component === 'function')

const face = registered.meta.inject('session-1')
check('inject face carries sessionId', face.sessionId === 'session-1')
check('inject face reports availability', face.available === true, String(face.available))
check('inject face exposes the shared directory store', face.directory === directory.store)
check('inject face exposes load()', typeof face.load === 'function')
check('inject face exposes select()', typeof face.select === 'function')

// ── render and inspect the label ─────────────────────────────────────────────
let rendered = null
let renderError = null
try {
  rendered = registered.component({ locked: false, t: key => key, ...face })
} catch (error) {
  renderError = error
}
check('component renders', renderError === null, renderError ? String(renderError.stack || renderError) : '')

function findNode(node, predicate, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) {
    for (const child of node) findNode(child, predicate, out)
    return out
  }
  if (typeof node === 'object') {
    if (predicate(node)) out.push(node)
    if (node.children) findNode(node.children, predicate, out)
  }
  return out
}
function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node === 'object' && node.children) collectText(node.children, out)
  return out
}

check('renders the trigger', findNode(rendered, n => n.props?.className === 'dml_trigger').length === 1)
const texts = collectText(rendered)
// The deliverable: DISPLAY names, not ids.
const triggerNode = findNode(rendered, n => n.props?.className === 'dml_trigger')[0]
const triggerText = collectText(triggerNode).join('')
check('trigger shows {providerName}/{modelName}', texts.includes('DeepSeek/DeepSeek V4.1 Flash'), texts.join(' | '))
check('trigger shows the effort name', texts.includes('High'), texts.join(' | '))
check('trigger omits the provider id', !texts.includes('deepseek-official/deepseek-v4.1-flash'), texts.join(' | '))
check(
  'trigger label is exactly the provider name + model name',
  triggerText.includes('DeepSeek/DeepSeek V4.1 Flash'),
  triggerText,
)

// ── the id fallback: a saved selection with no catalog entry left ────────────
// When the provider or model is gone from the catalog, the ids are the only
// names that exist, so the seat must fall back to them instead of rendering
// "undefined/undefined".
{
  const orphanState = {
    ...directoryState,
    current: { provider: 'retired-provider', model: 'retired-model', reasoningEffort: 'max' },
    groups: directoryState.groups,
  }
  const orphanStore = { getSnapshot: () => orphanState, subscribe: () => () => {} }
  const orphanDirectory = { store: orphanStore, load: async () => orphanState, select: async () => ({ ok: true }) }

  let orphanRegistered = null
  const orphanCtx = {
    effect: fn => {
      const d = fn()
      return typeof d === 'function' ? d : () => {}
    },
    inject: (services, cb) =>
      cb({
        slots: {
          inject: (slot, register) => register(),
          register: (meta, component) => {
            orphanRegistered = { meta, component }
            return () => {}
          },
        },
        modelDirectories: { directoryFor: () => orphanDirectory },
        sessions: { subagentAddress: () => undefined },
      }),
    get: () => undefined,
    locale: { register: () => () => {}, bind: () => key => key },
  }
  exportsObj.apply(orphanCtx)
  const orphanTexts = collectText(
    orphanRegistered.component({ locked: false, t: key => key, ...orphanRegistered.meta.inject('session-1') }),
  )
  check(
    'falls back to {provider}/{model} ids when the catalog entry is gone',
    orphanTexts.includes('retired-provider/retired-model'),
    orphanTexts.join(' | '),
  )
  check(
    'never renders an undefined label',
    !orphanTexts.some(x => x.includes('undefined')),
    orphanTexts.join(' | '),
  )
}

// ── the provider-folded tree ─────────────────────────────────────────────────
// A second snapshot with three providers, the saved selection in the MIDDLE
// one. The stub React cannot run a state transition, so this section pins the
// DEFAULT fold state the user sees on open: only the selection's provider is
// unfolded, and a folded provider contributes no model rows at all.
{
  const treeState = {
    ...directoryState,
    current: { provider: 'volcengine', model: 'glm-5.3', reasoningEffort: 'high' },
    groups: [
      {
        id: 'deepseek-account',
        name: 'DeepSeek Account',
        models: [
          { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
          { id: 'deepseek-v4.1', name: 'DeepSeek V4.1' },
        ],
      },
      {
        id: 'volcengine',
        name: '火山方舟',
        models: [
          { id: 'glm-5.3', name: 'GLM 5.3' },
          { id: 'kimi-k2', name: 'Kimi K2' },
        ],
      },
      { id: 'openrouter', name: 'OpenRouter', models: [{ id: 'qwen3-max', name: 'Qwen3 Max' }] },
    ],
  }
  const treeStore = { getSnapshot: () => treeState, subscribe: () => () => {} }

  let treeRegistered = null
  const treeCtx = {
    effect: fn => {
      const d = fn()
      return typeof d === 'function' ? d : () => {}
    },
    inject: (services, cb) =>
      cb({
        slots: {
          inject: (slot, register) => register(),
          register: (meta, component) => {
            treeRegistered = { meta, component }
            return () => {}
          },
        },
        modelDirectories: {
          directoryFor: () => ({ store: treeStore, load: async () => treeState, select: async () => ({ ok: true }) }),
        },
        sessions: { subagentAddress: () => undefined },
      }),
    get: () => undefined,
    locale: { register: () => () => {}, bind: () => key => key },
  }
  exportsObj.apply(treeCtx)

  // A tiny render loop over the stateful React stub. `useState` setters call
  // `scheduleRender`, so a click on a rendered node produces a new tree exactly
  // as React would.
  const props = { locked: false, t: key => key, ...treeRegistered.meta.inject('session-1') }
  let rendered = null
  const render = () => {
    hookCursor = 0
    rendered = treeRegistered.component(props)
  }
  scheduleRender = render
  resetHooks()
  render()

  const find = predicate => findNode(rendered, predicate)
  const toggles = () => find(n => n.props?.className === 'dml_providerToggle')
  const labels = () => toggles().map(n => collectText(n).join(''))
  const expanded = () =>
    toggles()
      .filter(n => n.props['aria-expanded'] === true)
      .map(n => collectText(n).join(''))
  const modelRows = () =>
    find(n => typeof n.props?.className === 'string' && n.props.className.includes('dml_modelRow'))
  const modelNames = () => modelRows().map(n => collectText(n).join(''))
  const clickNode = node => {
    node.props.onClick()
    render()
  }

  // Open the seat, then drill from the root pane into the model pane (a saved
  // selection makes the seat open on `root`, exactly like the shipped one).
  clickNode(find(n => n.props?.className === 'dml_trigger')[0])
  clickNode(find(n => n.props?.className === 'dml_cell')[0])

  check('renders one provider toggle per group', toggles().length === 3, `toggles=${toggles().length}`)
  check(
    'only the provider owning the selection starts unfolded',
    expanded().length === 1 && expanded()[0].includes('火山方舟'),
    JSON.stringify(expanded()),
  )
  check(
    'a folded provider contributes no model rows',
    JSON.stringify(modelNames()) === JSON.stringify(['GLM 5.3', 'Kimi K2']),
    JSON.stringify(modelNames()),
  )
  check(
    'each toggle announces its own model count',
    find(n => n.props?.className === 'dml_providerMeta').length === 3,
    String(find(n => n.props?.className === 'dml_providerMeta').length),
  )
  check(
    'the unfolded subtree is a labelled group',
    find(n => n.props?.role === 'group' && n.props?.['aria-label'] === '火山方舟').length === 1,
  )

  // Unfold a second provider: the first must stay open (independent folds).
  clickNode(toggles()[0])
  check(
    'unfolding another provider keeps the selection provider open',
    expanded().length === 2,
    JSON.stringify(expanded()),
  )
  check(
    'the newly unfolded subtree shows its models',
    modelNames().includes('DeepSeek V4.1 Flash'),
    JSON.stringify(modelNames()),
  )

  // Fold the selection's own provider.
  clickNode(toggles()[1])
  check(
    'clicking a provider folds exactly that subtree',
    expanded().length === 1 && !expanded()[0].includes('火山方舟'),
    JSON.stringify(expanded()),
  )
  check(
    'the folded subtree removes its model rows',
    !modelNames().includes('GLM 5.3'),
    JSON.stringify(modelNames()),
  )

  // A model row still selects through the tree.
  const selections = []
  props.select = selection => {
    selections.push(selection)
    return { ok: false, error: { code: 'test', message: 'stop here' } }
  }
  clickNode(modelRows().find(n => collectText(n).join('').includes('DeepSeek V4.1 Flash')))
  check(
    'choosing a model reports the provider/model pair',
    selections.length === 1 &&
      selections[0].provider === 'deepseek-account' &&
      selections[0].model === 'deepseek-v4.1-flash',
    JSON.stringify(selections),
  )

  check(
    'the tree no longer reuses the primitives MenuGroup (its heading cannot toggle)',
    !/\bMenuGroup\b/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')),
  )
}

// ── report ───────────────────────────────────────────────────────────────────
let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? `  [${r.detail}]` : ''}`)
}
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
