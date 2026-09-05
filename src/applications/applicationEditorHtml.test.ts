import { describe, it, expect } from 'vitest';
import { getHtml } from './applicationEditorHtml';
import {
  ApplicationFiles,
  emptyAppConfig,
  emptyApplicationFields,
  emptyServicePrincipalFields,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * `applicationEditorHtml.ts` is thin webview glue, excluded from coverage — its real logic lives in
 * the modules it imports, which are tested directly. But the embedded webview `<script>` is a
 * string of hand-written JS that TypeScript/ESLint/esbuild all wave through: a runtime error early
 * in its IIFE silently halts the rest of its setup, so a small mistake (e.g. a selector that
 * doesn't match a row type and hands a helper `null`) can break every button on the form while
 * every other check stays green. These smoke tests run that script against a minimal DOM stub,
 * with one of every kind of dynamic entry present, and assert it (a) neither throws nor skips
 * wiring the "+ Add …" buttons and (b) each "+ Add …" button appends markup of the shape the rest
 * of the script (e.g. `buildInputSnapshot`) expects.
 */

const populatedFiles: ApplicationFiles = {
  appConfig: {
    ...emptyAppConfig(),
    Variables: { owner_email: 'team@example.com' },
    Environments: [
      { name: 'Dev', publisherDomain: 'contoso.example.com', tenancy_type: 'ciam', environment_code: 'dev', Variables: {} },
    ],
    Dependencies: { Dep1: { AppName: 'other-app' } },
  },
  application: {
    ...emptyApplicationFields(),
    redirectUris: ['https://example.com/signin-oidc'],
    requiredPermissions: [
      { resourceAppId: '00000003-0000-0000-c000-000000000000', id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', type: 'Scope' },
      { resourceAppId: 'raw-unrecognised-guid', id: 'whatever', type: 'Role' },
    ],
    oauth2PermissionScopes: [
      {
        id: '{{ environment.Variables.MyScopeId }}',
        value: 'access_as_user',
        type: 'User',
        adminConsentDisplayName: 'Access',
        adminConsentDescription: 'Access on behalf of user',
        userConsentDisplayName: 'Access',
        userConsentDescription: 'Access on your behalf',
        isEnabled: true,
      },
    ],
  },
  federatedCredentials: [
    {
      name: 'dev-deploy',
      issuer: 'https://token.actions.githubusercontent.com',
      subject: 'repo:contoso/sample:environment:dev',
      audiences: ['api://AzureADTokenExchange'],
      description: '',
    },
  ],
  servicePrincipal: { ...emptyServicePrincipalFields(), tags: ['a-tag'] },
};

const permissionOptions = {
  '00000003-0000-0000-c000-000000000000': [
    { id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', label: 'User.Read', type: 'Scope' as const },
  ],
};

function extractScript(html: string): string {
  const match = html.match(/<script nonce="[^"]*">([\s\S]*)<\/script>/);
  if (!match) {
    throw new Error('no <script> block found in generated HTML');
  }
  return match[1];
}

function makeEl(): any {
  const el: any = {
    className: '',
    innerHTML: '',
    value: '',
    textContent: '',
    checked: false,
    open: false,
    dataset: {},
    selectedOptions: [],
    _appended: [] as any[],
    addEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    closest: () => makeEl(),
    appendChild: (c: any) => el._appended.push(c),
    remove: () => {},
    classList: { contains: () => false, add: () => {}, remove: () => {} },
  };
  return el;
}

interface StubRun {
  threw: unknown;
  wiredAddButtons: string[];
  clickHandlers: Record<string, () => void>;
  containers: Record<string, any>;
}

/**
 * Runs the webview script against a stub DOM. `afterRun`, if given, executes while that stub DOM
 * is still installed (e.g. to fire a captured "+ Add" click handler, which itself touches
 * `document`); its own throw is captured into the returned `threw` just like the script's.
 */
function runScriptWithStubDom(scriptBody: string, afterRun?: (run: StubRun) => void): StubRun {
  const wired = new Set<string>();
  const clickHandlers: Record<string, () => void> = {};
  const containers: Record<string, any> = {};
  const doc: any = {
    getElementById: (id: string) => {
      const el = makeEl();
      if (id.startsWith('add') && id.endsWith('Btn')) {
        el.addEventListener = (type: string, fn: () => void) => {
          if (type === 'click') {
            wired.add(id);
            clickHandlers[id] = fn;
          }
        };
      }
      if (id.endsWith('Rows')) {
        containers[id] = el;
      }
      return containers[id] ?? el;
    },
    querySelectorAll: (sel: string) => {
      if (sel === '.remove-row-btn') {
        return [
          { closest: (s: string) => (s.includes('oauth2-scope-card') ? makeEl() : null) },
          { closest: (s: string) => (s.includes('fedcred-card') ? makeEl() : null) },
          { closest: (s: string) => (s.includes('.row') ? makeEl() : null) },
        ];
      }
      return [];
    },
    createElement: () => makeEl(),
  };
  const g = globalThis as any;
  const priorDocument = g.document;
  const priorWindow = g.window;
  const priorAcquire = g.acquireVsCodeApi;
  g.document = doc;
  g.window = { addEventListener: () => {} };
  g.acquireVsCodeApi = () => ({ postMessage: () => {} });
  if (!g.crypto) {
    g.crypto = { randomUUID: () => 'stub-uuid' };
  }
  const run: StubRun = { threw: null, wiredAddButtons: [], clickHandlers, containers };
  try {
    new Function(scriptBody)();
    run.wiredAddButtons = [...wired].sort();
    afterRun?.(run);
  } catch (e) {
    run.threw = e;
  } finally {
    g.document = priorDocument;
    g.window = priorWindow;
    g.acquireVsCodeApi = priorAcquire;
  }
  return run;
}

const ADD_BUTTON_IDS = [
  'addDependencyBtn',
  'addEnvironmentBtn',
  'addFedCredBtn',
  'addOauth2ScopeBtn',
  'addPermissionBtn',
  'addRedirectUriBtn',
  'addTagBtn',
  'addVariableBtn',
].sort();

// Which container each "+ Add" button appends into, and a class its buildInputSnapshot selector
// (or the initial-render markup) requires the appended element to carry.
const ADD_BUTTON_EXPECTATIONS: Record<string, { container: string; requiredClass: string }> = {
  addVariableBtn: { container: 'variableRows', requiredClass: 'variable-row' },
  addEnvironmentBtn: { container: 'environmentRows', requiredClass: 'environment-row' },
  addDependencyBtn: { container: 'dependencyRows', requiredClass: 'dependency-row' },
  addRedirectUriBtn: { container: 'redirectUriRows', requiredClass: 'redirecturi-row' },
  addPermissionBtn: { container: 'permissionRows', requiredClass: 'permission-row' },
  addOauth2ScopeBtn: { container: 'oauth2ScopeRows', requiredClass: 'oauth2-scope-card' },
  addFedCredBtn: { container: 'fedcredRows', requiredClass: 'fedcred-card' },
  addTagBtn: { container: 'tagRows', requiredClass: 'tag-row' },
};

describe('getHtml — generated webview script', () => {
  it('is syntactically valid JavaScript', () => {
    const script = extractScript(getHtml('sample', populatedFiles, ['other-app'], permissionOptions));
    expect(() => new Function(script)).not.toThrow();
  });

  it('runs its setup without throwing and wires every "+ Add …" button, even with scope/credential cards present', () => {
    const script = extractScript(getHtml('sample', populatedFiles, ['other-app'], permissionOptions));
    const { threw, wiredAddButtons } = runScriptWithStubDom(script);
    expect(threw).toBeNull();
    expect(wiredAddButtons).toEqual(ADD_BUTTON_IDS);
  });

  it('also runs cleanly for an application with no dynamic entries at all', () => {
    const bare: ApplicationFiles = {
      appConfig: emptyAppConfig(),
      application: emptyApplicationFields(),
      federatedCredentials: [],
      servicePrincipal: emptyServicePrincipalFields(),
    };
    const { threw, wiredAddButtons } = runScriptWithStubDom(extractScript(getHtml('bare', bare, [], {})));
    expect(threw).toBeNull();
    expect(wiredAddButtons).toEqual(ADD_BUTTON_IDS);
  });

  it('has every "+ Add …" button append a row of the class the rest of the script expects', () => {
    const script = extractScript(getHtml('sample', populatedFiles, ['other-app'], permissionOptions));
    const failures: string[] = [];
    const run = runScriptWithStubDom(script, (r) => {
      for (const [buttonId, { container, requiredClass }] of Object.entries(ADD_BUTTON_EXPECTATIONS)) {
        const handler = r.clickHandlers[buttonId];
        if (typeof handler !== 'function') {
          failures.push(`${buttonId}: no click handler wired`);
          continue;
        }
        handler();
        const appended = r.containers[container]?._appended ?? [];
        const last = appended[appended.length - 1];
        if (!last) {
          failures.push(`${buttonId}: appended nothing to #${container}`);
          continue;
        }
        if (!String(last.className).split(/\s+/).includes(requiredClass)) {
          failures.push(`${buttonId}: appended "${last.className}" — missing required class "${requiredClass}"`);
        }
      }
    });
    expect(run.threw).toBeNull();
    expect(failures).toEqual([]);
  });

  it('renders the collapsed summary line for each scope and credential', () => {
    const html = getHtml('sample', populatedFiles, ['other-app'], permissionOptions);
    expect(html).toContain('<details class="oauth2-scope-card">');
    expect(html).toContain('access_as_user — MyScopeId');
    expect(html).toContain('<details class="fedcred-card">');
    expect(html).toContain('dev-deploy — repo:contoso/sample:environment:dev');
  });
});
