import { SidebarInset, SidebarProvider } from '@mico/ui'

import { AppSidebar } from './components/sidebar/app-sidebar'
import { WindowControls } from './components/window-controls/window-controls'

function App(): React.JSX.Element {
  return (
    <SidebarProvider
      className="home-workspace"
      data-platform={window.electron.process.platform}
      resize={{ defaultWidth: 240, maxWidth: 320, minWidth: 180 }}
    >
      <div aria-hidden="true" className="home-workspace__titlebar" />
      <AppSidebar />
      <WindowControls />
      <SidebarInset aria-label="Main content" className="home-workspace__content" />
    </SidebarProvider>
  )
}

export default App
