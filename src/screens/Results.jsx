import React from 'react';
import { useGame } from '../context/GameContext';

const Results = () => {
    const { teams, setGameState } = useGame();

    // Find winner by Stages Won first, then total score
    const sortedTeams = [...teams].sort((a, b) => {
        if (b.stagesWon !== a.stagesWon) return b.stagesWon - a.stagesWon;
        return b.score - a.score;
    });
    const winner = sortedTeams[0];
    const isDraw = (sortedTeams[0].stagesWon === sortedTeams[1].stagesWon) && (sortedTeams[0].score === sortedTeams[1].score);

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
                Terminé !
            </h2>

            {isDraw ? (
                <h1 style={{ fontSize: '3rem', color: 'var(--text-primary)' }}>Égalité !</h1>
            ) : (
                <div style={{ marginBottom: '1rem' }}>
                    <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)' }}>Vainqueurs</span>
                    <h1 style={{
                        fontSize: '3.5rem',
                        background: 'linear-gradient(to right, var(--accent-secondary), var(--accent-tertiary))',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        fontWeight: '900'
                    }}>
                        {winner.name}
                    </h1>
                </div>
            )}

            <div style={{ width: '100%', maxWidth: '350px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: '1.5rem' }}>
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
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <span style={{ color: 'var(--accent-primary)' }}>{team.stagesWon} manches</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total: {team.score} pts</span>
                        </div>
                    </div>
                ))}
            </div>

            <button
                onClick={() => setGameState('setup')}
                style={{
                    padding: '1.2rem 3rem',
                    background: 'var(--accent-primary)',
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
                Nouvelle Partie
            </button>
        </div>
    );
};

export default Results;
