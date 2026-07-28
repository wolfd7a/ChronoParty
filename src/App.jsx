import { GameProvider, useGame } from './context/GameContext';
import Home from './screens/Home';
import Game from './screens/Game';
import Results from './screens/Results';
import Setup from './screens/Setup';
import './App.css';

import RoundResults from './screens/RoundResults';
import PonGame from './games/pon/PonGame';

const GameContainer = () => {
  const { gameState, setGameState } = useGame();

  // P.O.N. takes over the whole viewport, so it renders outside the container.
  if (gameState === 'pon') {
    return <PonGame onExit={() => setGameState('home')} />;
  }

  return (
    <div className="app-container">
      {gameState === 'setup' && <Setup />}
      {gameState === 'home' && <Home />}
      {gameState === 'playing' && <Game />}
      {gameState === 'round_results' && <RoundResults />}
      {(gameState === 'results' || gameState === 'final_results') && <Results />}
    </div>
  );
};

function App() {
  return (
    <GameProvider>
      <GameContainer />
    </GameProvider>
  );
}

export default App;
