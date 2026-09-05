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
 * every other check stays green. This smoke test runs that script against a minimal DOM stub, with
 * one of every kind of dynamic entry present, and asserts it neither throws nor skips wiring up the
 * "+ Add …" buttons.
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
  return {
    className: '',
    innerHTML: '',
    value: '',
    textContent: '',
    checked: false,
    open: false,
    dataset: {},
    selectedOptions: [],
    addEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    closest: () => makeEl(),
    appendChild: () => {},
    remove: () => {},
    classList: { contains: () => false, add: () => {}, remove: () => {} },
  };
}

function runScriptWithStubDom(scriptBody: string): { threw: unknown; wiredAddButtons: string[] } {
  const wired = new Set<string>();
  const doc: any = {
    getElementById: (id: string) => {
      const el = makeEl();
      if (id.startsWith('add') && id.endsWith('Btn')) {
        el.addEventListener = (type: string) => {
          if (type === 'click') {
            wired.add(id);
          }
        };
      }
      return el;
    },
    querySelectorAll: (sel: string) => {
      if (sel === '.remove-row-btn') {
        // One existing remove button of each container kind — the scope/fedcred ones are the case
        // that regressed (a <details> card, not a `.row`).
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
  let threw: unknown = null;
  try {
    new Function(scriptBody)();
  } catch (e) {
    threw = e;
  } finally {
    g.document = priorDocument;
    g.window = priorWindow;
    g.acquireVsCodeApi = priorAcquire;
  }
  return { threw, wiredAddButtons: [...wired].sort() };
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

  it('renders the collapsed summary line for each scope and credential', () => {
    const html = getHtml('sample', populatedFiles, ['other-app'], permissionOptions);
    expect(html).toContain('<details class="oauth2-scope-card">');
    expect(html).toContain('access_as_user — MyScopeId');
    expect(html).toContain('<details class="fedcred-card">');
    expect(html).toContain('dev-deploy — repo:contoso/sample:environment:dev');
  });
});
