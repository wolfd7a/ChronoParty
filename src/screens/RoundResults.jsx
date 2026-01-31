import React from 'react';
import { useGame } from '../context/GameContext';

const RoundResults = () => {
    const { round, roundName, startNextRound, teams } = useGame();

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '2rem',
            textAlign: 'center',
            gap: '2rem'
        }}>
            <h2 style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '2px' }}>
                Fin de la Manche
            </h2>

            <h1 style={{
                fontSize: '2.5rem',
                marginBottom: '1rem',
                color: 'var(--accent-primary)'
            }}>
                {roundName} complétée !
            </h1>

            <div style={{ width: '100%', maxWidth: '350px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>Manches Gagnées</h3>
                {teams.map((team, index) => (
                    <div key={index} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '1rem',
                        borderBottom: index < teams.length - 1 ? '1px solid var(--glass-border)' : 'none',
                        fontSize: '1.2rem',
                        fontWeight: 'bold'
                    }}>
                        <span>{team.name}</span>
                        <span style={{ color: 'var(--accent-tertiary)' }}>{team.stagesWon}</span>
                    </div>
                ))}
            </div>

            <button
                onClick={startNextRound}
                style={{
                    padding: '1.2rem 3rem',
                    background: 'var(--success)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    width: '100%',
                    maxWidth: '300px',
                    boxShadow: 'var(--shadow-lg)'
                }}
            >
                Manche Suivante
            </button>
        </div>
    );
};

export default RoundResults;
