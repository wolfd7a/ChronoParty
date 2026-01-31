import React, { useState, useEffect } from 'react';

const Card = ({ term, category, onSwipe }) => {
    const [animate, setAnimate] = useState(false);

    useEffect(() => {
        setAnimate(true);
        const timer = setTimeout(() => setAnimate(false), 500);
        return () => clearTimeout(timer);
    }, [term]);

    return (
        <div className={`game-card ${animate ? 'pop-in' : ''}`} style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))',
            backdropFilter: 'blur(10px)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '2rem',
            height: '60vh',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            boxShadow: 'var(--shadow-lg)',
            marginTop: '1rem',
            textAlign: 'center',
            userSelect: 'none',
            width: '100%',
            maxWidth: '350px'
        }}>
            <span style={{
                color: 'var(--accent-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '2px',
                fontSize: '0.8rem',
                marginBottom: '1rem'
            }}>
                {category}
            </span>
            <h2 style={{
                fontSize: '2.5rem',
                fontWeight: '800',
                lineHeight: '1.1',
                background: 'linear-gradient(to right, var(--text-primary), #cbd5e1)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
            }}>
                {term}
            </h2>
        </div>
    );
};

export default Card;
