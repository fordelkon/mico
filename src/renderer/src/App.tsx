import Versions from './components/Versions'
import electronLogo from './assets/electron.svg'

const actionLinkClassName =
  'inline-block cursor-pointer whitespace-nowrap rounded-[20px] border border-(--ev-button-alt-border) bg-(--ev-button-alt-bg) px-5 text-center text-sm leading-[38px] font-semibold text-(--ev-button-alt-text) no-underline hover:border-(--ev-button-alt-hover-border) hover:bg-(--ev-button-alt-hover-bg) hover:text-(--ev-button-alt-hover-text)'

function App(): React.JSX.Element {
  const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')

  return (
    <>
      <img
        alt="logo"
        className="mb-5 h-32 w-32 [-webkit-user-drag:none] will-change-[filter] transition-[filter] duration-300 hover:[filter:drop-shadow(0_0_1.2em_#6988e6aa)]"
        src={electronLogo}
      />
      <div className="mb-2.5 text-sm leading-4 font-semibold text-(--ev-c-text-2)">
        Powered by electron-vite
      </div>
      <div className="mx-2.5 py-4 text-center text-[28px] leading-8 font-bold text-(--ev-c-text-1) max-[720px]:text-xl">
        Build an Electron app with{' '}
        <span className="bg-[linear-gradient(315deg,#087ea4_55%,#7c93ee)] bg-clip-text font-bold text-transparent">
          React
        </span>
        &nbsp;and{' '}
        <span className="bg-[linear-gradient(315deg,#3178c6_45%,#f0dc4e)] bg-clip-text font-bold text-transparent">
          TypeScript
        </span>
      </div>
      <p className="text-base leading-6 font-semibold text-(--ev-c-text-2) max-[350px]:hidden">
        Please try pressing{' '}
        <code className="rounded-[2px] bg-(--color-background-mute) px-[5px] py-[3px] font-mono text-[85%] font-semibold">
          F12
        </code>{' '}
        to open the devTool
      </p>
      <div className="-m-1.5 flex flex-wrap justify-start pt-8 max-[350px]:hidden">
        <div className="shrink-0 p-1.5">
          <a
            className={actionLinkClassName}
            href="https://electron-vite.org/"
            target="_blank"
            rel="noreferrer"
          >
            Documentation
          </a>
        </div>
        <div className="shrink-0 p-1.5">
          <a className={actionLinkClassName} target="_blank" rel="noreferrer" onClick={ipcHandle}>
            Send IPC
          </a>
        </div>
      </div>
      <Versions></Versions>
    </>
  )
}

export default App
