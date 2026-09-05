# UC042 — View Application Details

## Overview

This use case details the structured editor a user sees when clicking an application node under **Applications** (see [UC041 — Browse Application Definitions](UC041_BrowseApplicationDefinitions.md)) — one editable view of all four of an application's files (see [UC040 — Define an Application](UC040_DefineApplication.md)), replacing the need to open each raw file separately to see or change it. All four files — `AppConfig.yaml` and the three `.yaml.j2` templates — are parsed into structured fields and re-serialized as YAML on save; none of them is treated as an opaque blob of text (see Postconditions for the comment/formatting tradeoff this implies).

This opens as a genuine VS Code **Custom Editor** tab (`ApplicationEditorProvider`, view type `entra.applicationEditor`) rather than a plain webview panel — the specific reason being that its tab then shows VS Code's normal unsaved-changes dot the moment any field is edited, and the tab participates in VS Code's native save (Ctrl+S, the Save command, or the in-form Save button — all equivalent), revert, close-with-unsaved-changes-prompt, and hot-exit/crash-recovery behavior, the same as any ordinary file. This is deliberately not something built by hand on top of a plain webview: VS Code has no concept of "unsaved" for a plain `WebviewPanel` at all, so getting the native indicator and lifecycle required this move to a Custom Editor. Because there's no single real file backing an application folder's four files at once, the tab's identity is a synthetic URI (`entra-application-editor:` scheme, encoding the folder's real URI — see [UC041](UC041_BrowseApplicationDefinitions.md)'s Related section for the sibling `entra-application:` scheme used by the plain-text combined-document alternative).

This is deliberately **not** the shared artifact-viewer webview used elsewhere (see [UC032](../UC300_ArtifactBrowsing/UC032_PreviewArtifactBeforeDownload.md)/[UC033](../UC300_ArtifactBrowsing/UC033_ViewLocalProjectArtifacts.md)) — that one is read-only by construction, because it shows a downloaded Graph snapshot. An application definition is hand-authored source with no such snapshot to defer to, so this view is directly editable, the same way [UC012](../UC100_Security/UC012_AddConnection.md)'s connection form is.

## Actors

* **User**
* **Extension**

## Preconditions

* An application definition exists as a folder under `<artifactsRoot>/applications/` (its four files, per UC040, may be partially or fully present — this use case tolerates any of them being missing).

## Main Flow

1. User clicks an application node under **Applications** (see [UC041](UC041_BrowseApplicationDefinitions.md)).
2. The extension loads and parses all four of that application's files. A missing `AppConfig.yaml` is treated as blank metadata with no variables or environments, not an error; a missing `.yaml.j2` template is treated as an empty/default document for its section (no fields, `AzureADMyOrg` as the default sign-in audience where relevant) rather than an error.
3. The extension opens a Custom Editor tab (one per application folder — clicking an application whose view is already open brings that existing tab forward rather than opening a duplicate, the same as opening any file that's already open) with:
   * **Application name** and **Business unit** — the two plain metadata fields from `AppConfig.yaml`.
   * **Variables** — a dynamic list of key/value rows, one per entry in `AppConfig.yaml`'s `Variables` map, with controls to add or remove rows.
   * **Environments** — a dynamic list of rows, one per entry in `AppConfig.yaml`'s `Environments` list, each with the four fixed fields `name` / `publisherDomain` / `tenancy_type` / `environment_code`, with controls to add or remove rows. `tenancy_type` is a **Workforce**/**CIAM** dropdown (see [UC040](UC040_DefineApplication.md) for what the two values mean), not free text — a new row defaults to Workforce; a value already on disk that matches neither (there is no hard validation forcing it to, since this field is written by both this form and [UC035](../UC300_ArtifactBrowsing/UC035_DownloadApplicationArtifact.md)'s download path) is not specially preserved and is replaced with the dropdown's default the next time the row is rendered.
   * **Dependencies** — a dynamic list of rows, one per entry in `AppConfig.yaml`'s `Dependencies` map, each with a `Reference key` text field (the name used from a template, e.g. `SampleAPIApp`) and an `Application` dropdown populated from the other application folders that already exist under `<artifactsRoot>/applications/` (the application being edited excluded from its own list) — the target application is **selected, not typed**, so a dependency can't be saved pointing at an application that doesn't exist in the project. If a previously-saved reference points at an application folder that's since been renamed or removed, its value is still shown as a selectable option (alongside the current real folders) so it isn't silently discarded by opening and re-saving this form.
   * **Application (App Registration)**, parsed from `Application.yaml.j2`: a **Display name** text field, a **Sign-in audience** dropdown (the four values Graph accepts: `AzureADMyOrg`, `AzureADMultipleOrgs`, `AzureADandPersonalMicrosoftAccount`, `PersonalMicrosoftAccount`), a dynamic list of **Redirect URIs**, and a dynamic list of **Required permissions** — one row per individual permission with `Resource app ID` / `Permission ID` / `Type` (`Scope` or `Role`) fields, entered/edited as raw IDs with no human-readable name resolution (unlike [UC034](../UC300_ArtifactBrowsing/UC034_PreviewApplicationArtifact.md)'s read-only preview, which resolves a recognised Microsoft Graph permission ID to its name — not yet done here). Graph's nested `requiredResourceAccess[].resourceAccess[]` shape is flattened to this one row per permission for editing, and regrouped by `resourceAppId` back into that nested shape on save (see Postconditions).
   * **Federated Credentials**, parsed from `FederatedCredentials.yaml.j2`: a dynamic list of rows, one per credential, each with `Name` / `Issuer` / `Subject` / `Description` text fields and an `Audiences` field edited as a single comma-separated text value (Graph's `audiences` is a list, but is almost always single-valued in practice — the comma-separated field avoids a nested list-of-lists control while still round-tripping multiple values).
   * **Service Principal**, parsed from `ServicePrincipal.yaml.j2`: an `App ID` text field, an `App role assignment required` checkbox, a read-only **Generated tags** preview (see below), and a dynamic list of custom **Tags**.
   * The **Generated tags** preview shows four tags computed live from the **Application name** and **Business unit** fields above, following a fixed convention:
     * `AppName:<Environment>_<Business unit>_<Application name>`
     * `Environment:{{Environment}}`
     * `<Application name>`
     * `BusinessUnit:<Business unit>`

     `<Environment>`/`{{Environment}}` are left literal in both forms shown — there is no single environment value to substitute at this point, since one application definition renders once per `Environments` entry (see UC040). This preview is read-only and **not saved by this form** — it does not get written to `ServicePrincipal.yaml.j2`'s `tags` list, and is shown purely so an author can see the convention their organization's future deploy tooling is expected to apply automatically at deploy time. It updates as the Application name/Business unit fields are edited, before Save is selected. Because these tags are applied automatically at deploy time, a custom Tag starting with `AppName:`, `Environment:`, or `BusinessUnit:` is rejected on save (see A2) — a custom tag can never collide with, or be mistaken for, one of these generated ones.
   * Every text field accepts Nunjucks placeholders (e.g. `{{ name }}`, `{{ environment_code }}`) as literal text — the form does not evaluate or resolve them, it only reads and writes whatever string is present.
4. As soon as the user changes any field, the tab shows VS Code's normal unsaved-changes dot — this happens on every edit (keystroke, add-row, remove-row), not only when Save is explicitly selected, the same as typing in any other document.
5. User selects **Save** (the in-form button, Ctrl+S, or VS Code's Save command — all trigger the same native save flow). At that point the extension validates: Application name is non-empty, no two Variable rows share a key, no two Environment rows share a name (case-insensitively), every Dependency row has both a reference key and a selected application with no two rows sharing a reference key, and no custom Tag starts with a reserved prefix (`AppName:`, `Environment:`, `BusinessUnit:` — see below) — a row that is entirely blank in any of the dynamic lists (Variables, Environments, Dependencies, Redirect URIs, Required permissions, Federated Credentials, Tags) is treated as an unused spacer and silently dropped, not an error. Beyond that, the Application/Federated Credentials/Service Principal fields have no hard validation — any string a user types (including a malformed GUID or an empty required field) is accepted and saved as-is, since these files describe a future Graph payload the extension does not itself submit. If validation fails, VS Code reports the save as failed (its usual error notification) and an inline error is also shown next to the relevant section in the form; the tab stays open, dirty, and unsaved — nothing already entered is discarded (see A2).
6. On a successful save, the extension re-serializes all four files as YAML from the structured fields and writes them to the application's folder. The tab's unsaved-changes dot clears (VS Code's native behavior for any successful save) and a confirmation is shown; the tab itself stays open, showing what was just saved.

## Alternate Flows

### A1 — User discards unsaved changes

1. The user selects **Discard unsaved changes** in the form (or triggers VS Code's own Revert File command on the tab) while it has unsaved edits.
2. The extension asks VS Code to revert the document; the tab reloads the four files fresh from disk, discarding whatever was entered, and its unsaved-changes dot clears. The tab itself stays open, now showing the last-saved state.

### A1a — User closes the tab with unsaved changes

1. The user closes the tab (or VS Code as a whole) while it has unsaved edits.
2. VS Code shows its normal "Do you want to save the changes you made to *(application name)*?" prompt — Save, Don't Save, or Cancel — the same as closing any other unsaved file. This is new behavior versus the plain-webview form this use case replaces, which had no such protection and silently discarded unsaved edits on close.
3. **Save** runs the same validation and write as the Main Flow's step 5; **Don't Save** discards the edits and closes the tab; **Cancel** leaves the tab open, unsaved.
4. If VS Code or the extension host is closed/crashes while the tab has unsaved edits, VS Code's hot-exit/backup mechanism (`backupCustomDocument`) restores those edits the next time the tab is reopened, the same as it does for any other unsaved file.

### A2 — Validation failures

1. **Missing Application name** — blocks save with an inline error on that field.
2. **A Variable row has a value but no key** — blocks save; the extension does not guess a key or silently discard a value the user typed.
3. **Two Variable rows share the same key** — blocks save, naming the offending key.
4. **An Environment row has other fields filled in but no name** — blocks save, since `name` is how an environment is identified.
5. **Two Environment rows share the same name** (case-insensitively) — blocks save, naming the offending environment.
6. **A Dependency row has an application selected but no reference key** — blocks save; the extension does not invent a key.
7. **A Dependency row has a reference key but no application selected** — blocks save, naming the offending key.
8. **Two Dependency rows share the same reference key** — blocks save, naming the offending key.
9. **A custom Tag starts with a reserved prefix** (`AppName:`, `Environment:`, or `BusinessUnit:`) — blocks save, naming the offending tag and prefix; these prefixes are reserved for the Generated tags preview (step 3) applied automatically at deploy time, and a custom tag starting with one would collide with or be mistaken for a generated one.

## Postconditions

* `AppConfig.yaml` and all three `.yaml.j2` templates on disk reflect exactly what was in the form when **Save** was selected.
* **Known limitation, accepted deliberately for this version:** every one of the four files is parsed to structured fields and re-serialized fresh on save (none is edited in place or treated as opaque text), so saving drops:
  * any hand-written YAML comments in any of the four files;
  * the `Variables: &DefaultVariables` anchor UC040 describes, or any other YAML anchor/alias, in any file;
  * any keys beyond the ones this form models — e.g. an environment entry field beyond the four fixed ones, or an `Application`/`FederatedCredentials`/`ServicePrincipal` key this use case's field list (step 3) doesn't cover, such as `identifierUris`, `appRoles`, or `implicitGrantSettings` on `Application.yaml.j2`.

  This is an explicit, accepted tradeoff, not an oversight: a developer who needs to preserve a comment, anchor, or unmodelled field across an edit made through this form manages that the same way they'd manage any other unreviewed change — by reviewing the `git diff` this use case produces before committing it, and re-adding anything the form dropped if needed.
* No network call, authentication, or Graph interaction happens as a result of this use case — saving an application definition is entirely local, the same as UC040/UC041.
* The tab's title is the plain application name (e.g. "sample-web-app"), not the URL-encoded folder path the tab's underlying virtual URI actually contains — VS Code derives a Custom Editor's tab title from its document URI's path, and `webviewPanel.title` can't override that (see `applicationEditorUri.ts`), so the encoded folder location is carried in the URI's query string instead, keeping the path itself just the application name.
* The Service Principal section's **Generated tags** preview is never written to `ServicePrincipal.yaml.j2` — saving does not add, remove, or otherwise change anything in the `tags` list beyond what the custom Tags rows specify. Applying the generated tags to a deployed Service Principal is future deploy tooling's responsibility (see [Architecture/future_considerations.md](../../../Architecture/future_considerations.md)), not this use case's.

## Related

* [UC040 — Define an Application](UC040_DefineApplication.md) — defines the format this use case reads and writes, and the source of this use case's known comment/anchor/extra-field limitation.
* [UC041 — Browse Application Definitions](UC041_BrowseApplicationDefinitions.md) — how a user reaches this view; also still the way to open one of the four files directly, unedited by this form.
* [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md) — the closest existing precedent for an editable, validating webview form.
* [UC035 — Download an Application Artifact to the Project](../UC300_ArtifactBrowsing/UC035_DownloadApplicationArtifact.md) — can create or update the very folder this use case edits, from a live tenant capture; this form is the natural next step to open afterward (e.g. to parameterise the captured, concrete values back into Nunjucks placeholders by hand).
