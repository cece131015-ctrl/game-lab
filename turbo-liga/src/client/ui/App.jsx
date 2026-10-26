import { useGame } from './common.jsx';
import { Hud } from './hud.jsx';
import {
  MainMenu, BotsSetup, OnlineScreen, Lobby, Garage, Controls, Settings, Pause, EndScreen,
} from './menus.jsx';

const SCREENS = {
  main: MainMenu,
  bots: BotsSetup,
  online: OnlineScreen,
  lobby: Lobby,
  garage: Garage,
  controls: Controls,
  settings: Settings,
  pause: Pause,
  end: EndScreen,
};

function Toast() {
  const toast = useGame((s) => s.toast);
  return <div id="toast" className={toast ? 'show' : ''}>{toast?.text}</div>;
}

export function App() {
  const screen = useGame((s) => s.screen);
  const inGame = useGame((s) => s.inGame);
  const Current = screen ? SCREENS[screen] : null;
  return (
    <>
      {inGame && <Hud />}
      {Current && (
        <div id="menu" className={inGame ? 'over-game' : ''}>
          <Current />
        </div>
      )}
      <Toast />
    </>
  );
}
