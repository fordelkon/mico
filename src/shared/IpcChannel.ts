export enum IpcChannel {
  Appearance_GetPreference = 'appearance:get-preference',
  Appearance_GetResolved = 'appearance:get-resolved',
  Appearance_SetPreference = 'appearance:set-preference',
  Appearance_Changed = 'appearance:changed',
  Chat_Abort = 'chat:abort',
  Chat_Event = 'chat:event',
  Chat_Start = 'chat:start',
  WindowControls_Close = 'window-controls:close',
  WindowControls_FullscreenChanged = 'window-controls:fullscreen-changed',
  WindowControls_IsFullscreen = 'window-controls:is-fullscreen',
  WindowControls_IsMaximized = 'window-controls:is-maximized',
  WindowControls_Maximize = 'window-controls:maximize',
  WindowControls_MaximizedChanged = 'window-controls:maximized-changed',
  WindowControls_Minimize = 'window-controls:minimize',
  WindowControls_ToggleFullscreen = 'window-controls:toggle-fullscreen',
  WindowControls_Unmaximize = 'window-controls:unmaximize'
}
