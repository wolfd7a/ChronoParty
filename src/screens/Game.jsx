import React, { useEffect } from 'react';
import { useGame } from '../context/GameContext';
import Card from '../components/Card';
import Timer from '../components/Timer';

const Game = () => {
    const { currentCard, timeLeft, nextCard, score, currentTeam, nextTurn, isActive, roundName } = useGame();

    useEffect(() => {
        // If not active and time is 0, show "Next Team" overlay?
    }, [timeLeft, isActive]);

    // Turn End Screen
    if (!isActive && timeLeft === 0) {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                gap: '2rem'
            }}>
                <h1>Temps Écoulé !</h1>
                <p>Score du tour : {score}</p>
                <button
                    onClick={nextTurn}
                    style={{
                        padding: '1.2rem 3rem',
                        background: 'var(--accent-primary)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '1.2rem',
                        fontWeight: 'bold'
                    }}
                >
                    Équipe Suivante
                </button>
            </div>
        )
    }

    if (!currentCard) return <div style={{ textAlign: 'center', marginTop: '50%' }}>Chargement...</div>;

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            padding: '2rem 1rem 1rem', // Top padding for status bar area
            maxWidth: '500px',
            margin: '0 auto',
            position: 'relative'
        }}>
            {/* Round Indicator */}
            <div style={{
                textAlign: 'center',
                marginBottom: '1rem',
                color: 'var(--accent-tertiary)',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '1px'
            }}>
                {roundName}
            </div>
            {/* Header Info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center' }}>
                <Timer timeLeft={timeLeft} maxTime={30} />
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    marginLeft: '1rem'
                }}>
                    <div style={{
                        color: 'var(--accent-secondary)',
                        fontSize: '0.8rem',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap'
                    }}>
                        {currentTeam.name}
                    </div>
                    <div style={{
                        background: 'rgba(255,255,255,0.1)',
                        padding: '0.3rem 0.8rem',
                        borderRadius: 'var(--radius-full)',
                        fontWeight: 'bold',
                        fontSize: '1.2rem',
                        minWidth: '60px',
                        textAlign: 'center'
                    }}>
                        {score} pts
                    </div>
                </div>
            </div>

            {/* Main Card Area */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <Card
                    term={currentCard.term}
                    category={currentCard.category}
                />
            </div>

            {/* Controls */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1rem',
                marginTop: 'auto',
                paddingTop: '2rem'
            }}>
                <button
                    onClick={() => nextCard(false)} // Pass/Skip
                    style={{
                        padding: '1.5rem',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-secondary)',
                        border: '2px solid var(--text-secondary)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '1.2rem',
                        fontWeight: 'bold',
                        opacity: 0.8
                    }}
                >
                    Passer
                </button>

                <button
                    onClick={() => nextCard(true)} // Got it
                    style={{
                        padding: '1.5rem',
                        background: 'var(--success)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '1.2rem',
                        fontWeight: 'bold',
                        boxShadow: '0 4px 14px 0 rgba(34, 197, 94, 0.4)'
                    }}
                >
                    Trouvé !
                </button>
            </div>
        </div>
    );
};

export default Game;
