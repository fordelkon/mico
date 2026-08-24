import { SidebarInset, SidebarProvider } from '@mico/ui'

import { AppSidebar } from './components/sidebar/app-sidebar'

function App(): React.JSX.Element {
  return (
    <SidebarProvider
      className="home-workspace"
      resize={{ defaultWidth: 240, maxWidth: 320, minWidth: 180 }}
    >
      <AppSidebar />
      <SidebarInset aria-label="Main content" className="home-workspace__content" />
    </SidebarProvider>
  )
}

export default App
