export enum IpcChannel {
  /** Returns the persisted appearance preference. */
  Appearance_GetPreference = 'appearance:get-preference',
  /** Returns the operating-system-resolved appearance. */
  Appearance_GetResolved = 'appearance:get-resolved',
  /** Persists a new appearance preference. */
  Appearance_SetPreference = 'appearance:set-preference',
  /** Notifies the renderer that the resolved appearance changed. */
  Appearance_Changed = 'appearance:changed',

  /** Cancels a chat request owned by the invoking renderer. */
  Chat_Abort = 'chat:abort',
  /** Streams a chat lifecycle event to its owning renderer. */
  Chat_Event = 'chat:event',
  /** Returns the reasoning capabilities of the selected chat model. */
  Chat_GetCapabilities = 'chat:get-capabilities',
  /** Starts a chat request owned by the invoking renderer. */
  Chat_Start = 'chat:start',

  /** Adds a model entry to the provider library. */
  Providers_AddModel = 'providers:add-model',
  /** Adds a custom provider to the provider library. */
  Providers_AddCustomProvider = 'providers:add-custom-provider',
  /** Updates an existing custom provider. */
  Providers_UpdateCustomProvider = 'providers:update-custom-provider',
  /** Removes a custom provider and its dependent model entries. */
  Providers_RemoveCustomProvider = 'providers:remove-custom-provider',
  /** Discovers models exposed by a provider endpoint. */
  Providers_DiscoverModels = 'providers:discover-models',
  /** Returns the complete persisted provider-library snapshot. */
  Providers_GetLibrary = 'providers:get-library',
  /** Adds an explicitly named model entry. */
  Providers_ImportModel = 'providers:import-model',
  /** Changes whether a provider model entry is available for chat. */
  Providers_SetModelEnabled = 'providers:set-model-enabled',
  /** Replaces one provider's discovered model entries. */
  Providers_SyncModels = 'providers:sync-models',
  /** Removes a model entry from the provider library. */
  Providers_RemoveModel = 'providers:remove-model',
  /** Persists one built-in provider configuration. */
  Providers_SaveConfiguration = 'providers:save-configuration',
  /** Persists the complete provider-library snapshot atomically. */
  Providers_SaveLibrary = 'providers:save-library',
  /** Requests that the renderer persist a pending provider-library snapshot before closing. */
  Providers_FlushDraft = 'providers:flush-draft',
  /** Acknowledges that the requested provider-library draft flush completed. */
  Providers_DraftFlushed = 'providers:draft-flushed',
  /** Persists the selected provider-model entry for chat. */
  Providers_SelectModel = 'providers:select-model',
  /** Persists the provider page last visited in settings. */
  Providers_SelectProvider = 'providers:select-provider',
  /** Verifies connectivity for a model through a provider endpoint. */
  Providers_TestModel = 'providers:test-model',

  /** Closes the main application window. */
  WindowControls_Close = 'window-controls:close',
  /** Notifies the renderer that fullscreen state changed. */
  WindowControls_FullscreenChanged = 'window-controls:fullscreen-changed',
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
