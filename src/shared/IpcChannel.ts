export enum IpcChannel {
  /** Returns the persisted appearance preference. */
  Appearance_GetPreference = 'appearance:get-preference',
  /** Returns the operating-system-resolved appearance. */
  Appearance_GetResolved = 'appearance:get-resolved',
  /** Persists a new appearance preference. */
  Appearance_SetPreference = 'appearance:set-preference',
  /** Notifies the renderer that the resolved appearance changed. */
  Appearance_Changed = 'appearance:changed',
  /** Returns the complete persisted and resolved theme state. */
  Appearance_GetThemeState = 'appearance:get-theme-state',
  /** Persists all independent light and dark theme selections. */
  Appearance_SetThemePreferences = 'appearance:set-theme-preferences',
  /** Notifies the renderer that the complete resolved theme state changed. */
  Appearance_ThemeChanged = 'appearance:theme-changed',

  /** Opens the native picker for supported code and text documents. */
  Attachments_PickCodeDocuments = 'attachments:pick-code-documents',

  /** Cancels a turn owned by the invoking renderer. */
  Chat_AbortTurn = 'chat:abort-turn',
  /** Streams a turn lifecycle event to its owning renderer. */
  Chat_TurnEvent = 'chat:turn-event',
  /** Returns the reasoning capabilities of the selected chat model. */
  Chat_GetCapabilities = 'chat:get-capabilities',
  /** Starts a turn owned by the invoking renderer. */
  Chat_StartTurn = 'chat:start-turn',
  /** Answers a pending tool approval owned by the invoking renderer. */
  Chat_RespondToPermission = 'chat:respond-to-permission',

  /** Creates a persisted session before its first message. */
  Sessions_Create = 'sessions:create',
  /** Permanently removes a session and its runtime records. */
  Sessions_Delete = 'sessions:delete',
  /** Returns session summaries. */
  Sessions_List = 'sessions:list',
  /** Returns one session's visible persisted transcript. */
  Sessions_Load = 'sessions:load',
  /** Changes a session title. */
  Sessions_Rename = 'sessions:rename',
  /** Persists the requested thinking effort for a session. */
  Sessions_SetThinkingEffort = 'sessions:set-thinking-effort',
  /** Persists the selected model entry for a session without changing the global selection. */
  Sessions_SetModelEntry = 'sessions:set-model-entry',
  /** Notifies the renderer that a background title generation completed. */
  Sessions_TitleUpdated = 'sessions:title-updated',

  /** Opens the native directory picker and registers the chosen project. */
  Workspaces_AddFromDialog = 'workspaces:add-from-dialog',
  /** Archives a project without invalidating historical session snapshots. */
  Workspaces_Archive = 'workspaces:archive',
  /** Returns projects available to new chats. */
  Workspaces_List = 'workspaces:list',
  /** Changes a project's display name without changing its path. */
  Workspaces_Rename = 'workspaces:rename',
  /** Changes the project used by future new chats. */
  Workspaces_SetDefault = 'workspaces:set-default',
  /** Reveals an active workspace directory in the operating system file manager. */
  Workspaces_Reveal = 'workspaces:reveal',

  /** Adds a model entry to the provider library. */
  Providers_AddModel = 'providers:add-model',
  /** Discovers models exposed by a provider endpoint. */
  Providers_DiscoverModels = 'providers:discover-models',
  /** Returns the complete persisted provider-library snapshot. */
  Providers_GetLibrary = 'providers:get-library',
  /** Replaces one provider's discovered model entries. */
  Providers_SyncModels = 'providers:sync-models',
  /** Persists the complete provider-library snapshot atomically. */
  Providers_SaveLibrary = 'providers:save-library',
  /** Requests that the renderer persist a pending provider-library snapshot before closing. */
  Providers_FlushDraft = 'providers:flush-draft',
  /** Acknowledges that the requested provider-library draft flush completed. */
  Providers_DraftFlushed = 'providers:draft-flushed',
  /** Verifies connectivity for a model through a provider endpoint. */
  Providers_TestModel = 'providers:test-model',

  /** Closes the main application window. */
  WindowControls_Close = 'window-controls:close',
  /** Notifies the renderer that fullscreen state changed. */
  WindowControls_FullscreenChanged = 'window-controls:fullscreen-changed',
  /** Notifies the renderer that native window focus changed. */
  WindowControls_FocusChanged = 'window-controls:focus-changed',
  /** Returns whether the main window has native focus. */
  WindowControls_IsFocused = 'window-controls:is-focused',
  /** Returns whether the main window is fullscreen. */
  WindowControls_IsFullscreen = 'window-controls:is-fullscreen',
  /** Returns whether the main window is maximized. */
  WindowControls_IsMaximized = 'window-controls:is-maximized',
  /** Maximizes the main application window. */
  WindowControls_Maximize = 'window-controls:maximize',
  /** Notifies the renderer that maximized state changed. */
  WindowControls_MaximizedChanged = 'window-controls:maximized-changed',
  /** Minimizes the main application window. */
  WindowControls_Minimize = 'window-controls:minimize',
  /** Toggles fullscreen state for the main application window. */
  WindowControls_ToggleFullscreen = 'window-controls:toggle-fullscreen',
  /** Restores the main application window from maximized state. */
  WindowControls_Unmaximize = 'window-controls:unmaximize'
}
