import React from 'react';
import { useGame } from '../context/GameContext';

const Home = () => {
    const { startGame, setGameState } = useGame();

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '80vh',
            gap: '2rem'
        }}>
            <h1 style={{
                fontSize: '4rem',
                fontWeight: '900',
                background: 'linear-gradient(to bottom right, var(--accent-primary), var(--accent-secondary))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                textAlign: 'center',
                lineHeight: '1'
            }}>
                Chrono<br />Party!
            </h1>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '300px' }}>
                <button
                    onClick={() => startGame('facile')}
                    style={{
                        padding: '1.2rem',
                        background: 'var(--accent-primary)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '1.2rem',
                        fontWeight: 'bold',
                        boxShadow: 'var(--shadow-lg)',
                        transition: 'transform 0.1s active'
                    }}
                >
                    Mode Facile
                </button>

                <button
                    onClick={() => startGame('difficile')}
                    style={{
                        padding: '1.2rem',
                        background: 'transparent',
                        border: '2px solid var(--accent-tertiary)',
                        color: 'var(--text-primary)',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '1.2rem',
                        fontWeight: 'bold'
                    }}
                >
                    Mode Difficile
                </button>

                <button
                    onClick={() => setGameState('pon')}
                    style={{
                        marginTop: '0.5rem',
                        padding: '1.2rem',
                        background: '#05070a',
                        border: '1px solid rgba(120, 148, 180, 0.35)',
                        color: '#cfd8e4',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '1.1rem',
                        fontWeight: 'bold',
                        letterSpacing: '0.28em',
                        fontFamily: 'ui-monospace, Menlo, Consolas, monospace'
                    }}
                >
                    P.O.N.
                </button>
            </div>

            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '80%' }}>
                Faites deviner un maximum de cartes avant la fin du temps !
            </p>
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '80%', fontSize: '0.8rem', opacity: 0.7 }}>
                P.O.N. — braquage furtif en solo. Quelque chose vous chasse dans le noir.
            </p>
        </div >
    );
};

export default Home;
