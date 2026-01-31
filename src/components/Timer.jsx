import React from 'react';

const Timer = ({ timeLeft, maxTime = 60 }) => {
    const percentage = (timeLeft / maxTime) * 100;
    const isLow = timeLeft <= 10;

    return (
        <div style={{ width: '100%', maxWidth: '350px', margin: '0 auto' }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.5rem'
            }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Temps Restant</span>
                <span style={{
                    color: isLow ? 'var(--danger)' : 'var(--text-primary)',
                    fontSize: '1.5rem',
                    fontWeight: 'bold',
                    transition: 'color 0.3s ease'
                }}>{timeLeft}s</span>
            </div>

            <div style={{
                height: '10px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 'var(--radius-full)',
                overflow: 'hidden'
            }}>
                <div style={{
                    height: '100%',
                    width: `${percentage}%`,
                    background: isLow ? 'var(--danger)' : 'var(--accent-primary)',
                    borderRadius: 'var(--radius-full)',
                    transition: 'width 1s linear, background-color 0.3s'
                }} />
            </div>
        </div>
    );
};

export default Timer;
