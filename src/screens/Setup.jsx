import React, { useState } from 'react';
import { useGame } from '../context/GameContext';

const Setup = () => {
    const { setTeams: setGameTeams, setGameState } = useGame();
    const [teams, setTeams] = useState([
        { name: 'Équipe 1', score: 0 },
        { name: 'Équipe 2', score: 0 }
    ]);

    const handleNameChange = (index, name) => {
        const newTeams = [...teams];
        newTeams[index].name = name;
        setTeams(newTeams);
    };

    const handleStart = () => {
        setGameTeams(teams);
        setGameState('home'); // Go to Difficulty selection after setup
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '2rem',
            gap: '2rem'
        }}>
            <h1 style={{
                fontSize: '2.5rem',
                background: 'linear-gradient(to right, #fff, #94a3b8)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
            }}>
                Équipes
            </h1>

            <div style={{ width: '100%', maxWidth: '350px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {teams.map((team, index) => (
                    <div key={index}>
                        <label style={{
                            display: 'block',
                            color: 'var(--text-secondary)',
                            marginBottom: '0.5rem',
                            fontSize: '0.9rem'
                        }}>
                            Nom de l'équipe {index + 1}
                        </label>
                        <input
                            type="text"
                            value={team.name}
                            onChange={(e) => handleNameChange(index, e.target.value)}
                            style={{
                                width: '100%',
                                padding: '1rem',
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--glass-border)',
                                borderRadius: 'var(--radius-md)',
                                color: 'var(--text-primary)',
                                fontSize: '1.1rem',
                                outline: 'none'
                            }}
                        />
                    </div>
                ))}
            </div>

            <button
                onClick={handleStart}
                style={{
                    marginTop: '1rem',
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
                Continuer
            </button>
        </div>
    );
};

export default Setup;
