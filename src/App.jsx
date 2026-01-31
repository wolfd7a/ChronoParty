import { GameProvider, useGame } from './context/GameContext';
import Home from './screens/Home';
import Game from './screens/Game';
import Results from './screens/Results';
import Setup from './screens/Setup';
import './App.css';

import RoundResults from './screens/RoundResults';

const GameContainer = () => {
  const { gameState } = useGame();

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
