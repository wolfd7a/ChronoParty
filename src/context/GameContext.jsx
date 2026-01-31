import { createContext, useContext, useState, useEffect } from 'react';
import allCards from '../data/cards.json';

const GameContext = createContext();

export const useGame = () => useContext(GameContext);

export const GameProvider = ({ children }) => {
    const [gameState, setGameState] = useState('setup'); // setup, home, playing, round_results, final_results
    const [difficulty, setDifficulty] = useState('facile');
    const [cards, setCards] = useState([]); // Current deck for the round
    const [guessedCards, setGuessedCards] = useState([]); // Cards guessed in Round 1 (to be recycled)
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [score, setScore] = useState(0); // Current turn score
    const [timeLeft, setTimeLeft] = useState(30); // Reduced to 30s
    const [isActive, setIsActive] = useState(false);
    const [round, setRound] = useState(1); // 1: Description, 2: One Word, 3: Mime

    // Team State
    const [teams, setTeams] = useState([
        { name: 'Équipe 1', score: 0, stagesWon: 0, currentRoundScore: 0 },
        { name: 'Équipe 2', score: 0, stagesWon: 0, currentRoundScore: 0 }
    ]);
    const [currentTeamIndex, setCurrentTeamIndex] = useState(0);

    // Fisher-Yates Shuffle
    const shuffleArray = (array) => {
        let currentIndex = array.length, randomIndex;
        while (currentIndex != 0) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;
            [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
        }
        return array;
    };

    const getRoundName = (r) => {
        switch (r) {
            case 1: return "1: Description";
            case 2: return "2: Un Mot";
            case 3: return "3: Mime";
            default: return "";
        }
    };

    const startGame = (selectedDifficulty) => {
        setDifficulty(selectedDifficulty);
        setRound(1);
        setGuessedCards([]);

        // Logic: 'facile' gets only 'facile'. 'difficile' gets EVERYTHING.
        const filteredCards = allCards.filter(c =>
            selectedDifficulty === 'difficile' ? true : c.difficulty === selectedDifficulty
        );

        // Shuffle and pick a pool that is enough for the game?
        // User wants "First to 21" points per round.
        // Ensure we have enough cards. If deck < 21, game is impossible, but deck is 100+.
        const shuffled = shuffleArray([...filteredCards]);

        setCards(shuffled);
        setCurrentCardIndex(0);
        setScore(0);
        setTimeLeft(30);
        setCurrentTeamIndex(0);

        // Reset Team Scores
        setTeams(t => t.map(team => ({ ...team, score: 0, stagesWon: 0, currentRoundScore: 0 })));

        setGameState('playing');
        setIsActive(true);
    };

    const startNextRound = () => {
        if (round >= 3) {
            setGameState('final_results');
            return;
        }

        const nextRound = round + 1;
        setRound(nextRound);

        // Recycle cards guessed in Round 1?
        // User said: "Each stage ends when one team reaches 21 points".
        // Usually Time's Up recycles ALL cards guessed.
        // But if Round 1 ended early (at 21 points), there might be unguessed cards remaining in the deck.
        // Standard Rules: Use the SAME set of cards for all 3 rounds.
        // So Round 2 should use the cards that *were guessed* in Round 1? Or just the same starting deck?
        // Standard: You recycle the cards guessed. "We play with the cards we found".
        // User prompt: "Integrate teams names... Each stage ends when one team reaches 21 points".
        // I will assume we recycle the *guessed* cards.
        // However, if Round 1 ended at 21 points, we only have ~21-40 cards guessed total?
        // Wait, if "One team reaches 21", the other might have 0-20. So max cards guessed = 41.
        // This is enough for Round 2.

        // If guessedCards is empty (unlikely), fallback to reshuffle original?
        // Let's use `guessedCards` if available, otherwise `cards` (safety).
        const deckToUse = guessedCards.length > 0 ? guessedCards : cards;
        const shuffled = shuffleArray([...deckToUse]);

        setCards(shuffled);
        setGuessedCards(shuffled); // Simplify: Round 3 will use Round 2's cards (which are same as Round 1)
        setCurrentCardIndex(0);
        setScore(0);
        setTimeLeft(30);
        setCurrentTeamIndex(0); // Reset who starts? Or continue? Usually next player. Let's reset for simplicity.

        // Reset Round Scores
        setTeams(t => t.map(team => ({ ...team, currentRoundScore: 0 })));

        setGameState('playing');
        setIsActive(true);
    };

    const nextCard = (correct) => {
        if (!isActive) return;

        if (correct) {
            const card = cards[currentCardIndex];
            // Add to guessed pool if round 1
            if (round === 1) {
                setGuessedCards(prev => [...prev, card]);
            }

            setScore(s => s + 1);

            // Update team scores safely
            setTeams(prevTeams => {
                return prevTeams.map((team, index) => {
                    if (index === currentTeamIndex) {
                        const newRoundScore = team.currentRoundScore + 1;
                        const justWon = newRoundScore === 21;

                        return {
                            ...team,
                            score: team.score + 1,
                            currentRoundScore: newRoundScore,
                            stagesWon: justWon ? team.stagesWon + 1 : team.stagesWon
                        };
                    }
                    return team;
                });
            });
            // Note: We don't check win condition here anymore to avoid race conditions.
            // The CheckWinCondition useEffect will handle it.
        }

        // Check if deck exhausted or move to next
        if (currentCardIndex + 1 < cards.length) {
            setCurrentCardIndex(i => i + 1);
        } else {
            // Reshuffle current deck if exhausted but round not won
            const curr = [...cards];
            const reshuffled = shuffleArray(curr);
            setCards(reshuffled);
            setCurrentCardIndex(0);
        }
    };

    const nextTurn = () => {
        setCurrentTeamIndex(prev => (prev === 0 ? 1 : 0));
        setScore(0);
        setTimeLeft(30);
        setIsActive(true);
    };

    const endGame = () => { // Called when time runs out
        setIsActive(false);
    };

    // Check Win Condition Effect
    useEffect(() => {
        if (gameState === 'playing') {
            const winner = teams.find(t => t.currentRoundScore >= 21);
            if (winner) {
                setIsActive(false);
                setGameState(round === 3 ? 'final_results' : 'round_results');
            }
        }
    }, [teams, gameState, round]);

    // Timer logic
    useEffect(() => {
        let interval = null;
        if (isActive && timeLeft > 0) {
            interval = setInterval(() => {
                setTimeLeft(seconds => seconds - 1);
            }, 1000);
        } else if (timeLeft === 0) {
            clearInterval(interval);
            // Time run out!
            // Switch teams automatically?
            setIsActive(false);
            // In this version, we probably want a "Next Turn" button.
            // Let's set a distinct state or handle in UI.
            // setGameState('turn_end')?
        }
        return () => clearInterval(interval);
    }, [isActive, timeLeft]);

    const value = {
        gameState,
        difficulty,
        round,
        roundName: getRoundName(round),
        score, // Current turn score
        timeLeft,
        teams,
        currentTeam: teams[currentTeamIndex],
        currentCard: cards[currentCardIndex],
        startGame,
        startNextRound,
        nextCard,
        nextTurn,
        endGame,
        setGameState,
        setTeams,
        isActive
    };

    return (
        <GameContext.Provider value={value}>
            {children}
        </GameContext.Provider>
    );
};
