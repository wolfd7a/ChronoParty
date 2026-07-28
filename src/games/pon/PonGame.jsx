import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from './engine/game.js';
import { DIFFICULTY } from './engine/ai.js';
import TabletMap from './TabletMap.jsx';
import './pon.css';

const QUALITIES = [
  { label: 'Low', value: 220 },
  { label: 'Med', value: 300 },
  { label: 'High', value: 400 },
];

const CONTROLS = [
  ['W A S D', 'Move (ZQSD works too)'],
  ['Mouse', 'Look — click to capture'],
  ['Shift', 'Sprint (loud, tiring)'],
  ['Ctrl / C', 'Crouch (quiet, slow)'],
  ['F', 'Torch — it sees the light'],
  ['E', 'Take / hold to hack'],
  ['G', 'Throw a bolt as a decoy'],
  ['Tab', 'Tactical tablet'],
  ['Esc', 'Pause'],
];

function fmtTime(t) {
  const s = Math.floor(t || 0);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function Meter({ kind, value }) {
  return (
    <div className={`pon-meter ${kind}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export default function PonGame({ onExit }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const gameRef = useRef(null);

  const [phase, setPhase] = useState('brief');
  const [difficulty, setDifficulty] = useState('pro');
  const [quality, setQuality] = useState(300);
  const [sound, setSound] = useState(true);
  const [hud, setHud] = useState(null);
  const [result, setResult] = useState(null);
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState(null);
  const [coarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches,
  );

  /* ---- boot the engine whenever we enter the play phase ---- */
  useEffect(() => {
    if (phase !== 'play') return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const game = new Game(canvas, {
      difficulty,
      quality,
      onHud: setHud,
      onEnd: (r) => {
        setResult(r);
        setPhase('over');
        if (document.pointerLockElement) document.exitPointerLock();
      },
    });
    gameRef.current = game;
    setLevel(game.lv);
    game.audio.setEnabled(sound);

    const fit = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      game.resize(Math.max(320, r.width), Math.max(240, r.height), quality);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrapRef.current);
    game.start();

    return () => {
      ro.disconnect();
      game.destroy();
      gameRef.current = null;
    };
    // `quality` and `sound` are applied imperatively below so changing them
    // mid-heist never restarts the run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, difficulty]);

  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    g.resize(Math.max(320, r.width), Math.max(240, r.height), quality);
  }, [quality]);

  useEffect(() => {
    gameRef.current?.audio.setEnabled(sound);
  }, [sound]);

  useEffect(() => {
    gameRef.current?.setPaused(paused);
  }, [paused]);

  /* ---- pause plumbing ---- */
  useEffect(() => {
    if (phase !== 'play') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setPaused((p) => !p);
    };
    const onLock = () => {
      if (!document.pointerLockElement && !coarse) setPaused(true);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerlockchange', onLock);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerlockchange', onLock);
    };
  }, [phase, coarse]);

  const beginRun = useCallback(() => {
    setResult(null);
    setHud(null);
    setPaused(false);
    setPhase('play');
  }, []);

  const retry = useCallback(() => {
    setPhase('brief');
    // a tick later the brief screen's Start puts us back in
    setResult(null);
  }, []);

  const grabPointer = useCallback(() => {
    if (paused) return;
    gameRef.current?.requestPointerLock();
  }, [paused]);

  const holdBtn = (name) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      if (gameRef.current) gameRef.current.buttons[name] = true;
    },
    onPointerUp: () => {
      if (gameRef.current) gameRef.current.buttons[name] = false;
    },
    onPointerLeave: () => {
      if (gameRef.current) gameRef.current.buttons[name] = false;
    },
  });

  /* ------------------------------------------------------------ */

  if (phase === 'brief') {
    return (
      <div className="pon">
        <div className="pon-screen">
          <h1 className="pon-title">P.O.N.</h1>
          <div className="pon-tagline">Stealth · Heist · Horror</div>
          <p className="pon-body">
            Meridian Trust, 03:40. You are not the hero of this story — you are
            the reason one exists. Take <strong>six pieces</strong> out of the
            building, at least <strong>two of them data</strong>, and reach the
            fire stairwell. Cameras cost you information. Drones cost you your
            position. <strong>It</strong> costs you the run.
          </p>
          <p className="pon-body" style={{ color: '#e0a13a' }}>
            It moves faster than you sprint. You will not outrun it. Break line
            of sight, kill your torch, crouch, and let it lose the thread.
          </p>

          <div className="pon-diffs">
            {Object.entries(DIFFICULTY).map(([key, d]) => (
              <button
                key={key}
                type="button"
                className="pon-diff"
                aria-pressed={difficulty === key}
                onClick={() => setDifficulty(key)}
              >
                <b>{d.label}</b>
                <span>{d.blurb}</span>
              </button>
            ))}
          </div>

          <div className="pon-keys">
            {CONTROLS.map(([k, v]) => (
              <div key={k}>
                <b>{k}</b> {v}
              </div>
            ))}
          </div>

          <div className="pon-quality">
            Detail
            {QUALITIES.map((q) => (
              <button
                key={q.value}
                type="button"
                aria-pressed={quality === q.value}
                onClick={() => setQuality(q.value)}
              >
                {q.label}
              </button>
            ))}
          </div>

          <div className="pon-actions">
            <button type="button" className="pon-btn" onClick={beginRun}>
              Go in
            </button>
            {onExit && (
              <button type="button" className="pon-btn ghost" onClick={onExit}>
                Back
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const pr = hud?.predator;
  const hunting = pr?.hunting;
  const dangerOpacity = Math.min(0.9, Math.max(0, hud?.dread || 0) ** 1.6);

  return (
    <div className="pon" ref={wrapRef}>
      <canvas ref={canvasRef} className="pon-canvas" onClick={grabPointer} />

      <div className="pon-hud">
        <div className="pon-danger" style={{ opacity: dangerOpacity }} />
        {!paused && <div className="pon-reticle" />}
        {hunting && <div className="pon-hunting">It is coming</div>}

        {hud && (
          <>
            <div className="pon-panel pon-topleft">
              <span className="pon-label">The take</span>
              <div className="pon-big">
                <span className={hud.items >= hud.needItems ? 'pon-obj-done' : 'pon-obj-todo'}>
                  {hud.items}
                </span>
                <span className="pon-sub"> / {hud.needItems} pieces</span>
              </div>
              <div className="pon-sub">
                data{' '}
                <span className={hud.data >= hud.needData ? 'pon-obj-done' : 'pon-obj-todo'}>
                  {hud.data}/{hud.needData}
                </span>
                {'  ·  '}${(hud.value / 1000).toFixed(0)}k
              </div>
              <div className="pon-chips">
                <span className="pon-chip">{hud.zone || '—'}</span>
                {hud.hidden && <span className="pon-chip good">Hidden</span>}
                {hud.strikes <= 1 && <span className="pon-chip warn">Last strike</span>}
              </div>
            </div>

            <div className="pon-panel pon-topright">
              <span className="pon-label">Clock</span>
              <div className="pon-big">{fmtTime(hud.time)}</div>
              <span className="pon-label" style={{ marginTop: 6 }}>Heat</span>
              <Meter kind="heat" value={hud.heat * 100} />
              {hud.cameraDetect > 0.02 && (
                <>
                  <span className="pon-label">Camera lock</span>
                  <Meter kind="detect" value={hud.cameraDetect * 100} />
                </>
              )}
              <div className="pon-sub">bolts ×{hud.noisemakers}</div>
            </div>

            <div className="pon-panel pon-bottomleft">
              <span className="pon-label">Stamina</span>
              <Meter kind="stam" value={hud.stamina} />
              <span className="pon-label">Torch</span>
              <Meter kind="batt" value={hud.battery} />
              <div className="pon-chips">
                <span className={`pon-chip ${hud.flashlight ? 'warn' : ''}`}>Torch</span>
                <span className={`pon-chip ${hud.crouching ? 'on' : ''}`}>Crouch</span>
                <span className={`pon-chip ${hud.sprinting ? 'warn' : ''}`}>Sprint</span>
              </div>
            </div>

            {hud.prompt && <div className="pon-prompt">{hud.prompt}</div>}
            {hud.progress > 0 && (
              <div className="pon-progress">
                <i style={{ width: `${hud.progress * 100}%` }} />
              </div>
            )}

            <div className="pon-messages">
              {hud.messages.map((m, i) => (
                <div key={`${i}-${m}`}>{m}</div>
              ))}
            </div>
          </>
        )}

        {coarse && !paused && phase === 'play' && (
          <div className="pon-touch">
            <button type="button" {...holdBtn('crouch')}>Crouch</button>
            <button type="button" {...holdBtn('sprint')}>Run</button>
            <button type="button" {...holdBtn('interact')}>Use</button>
            <button type="button" onClick={() => gameRef.current?.toggleFlashlight()}>Torch</button>
            <button type="button" onClick={() => gameRef.current?.throwNoisemaker()}>Bolt</button>
            <button
              type="button"
              onClick={() => {
                const g = gameRef.current;
                if (g) g.tablet = !g.tablet;
              }}
            >
              Map
            </button>
          </div>
        )}
      </div>

      {hud?.tablet && !paused && (
        <div className="pon-tablet">
          <div className="pon-tablet-frame">
            <div className="pon-tablet-head">
              <span>Meridian Trust — floorplan</span>
              <span>{fmtTime(hud.time)}</span>
            </div>
            <TabletMap level={level} hud={hud} />
            <div className="pon-legend">
              <span style={{ color: '#e0a13a' }}>cash</span>
              <span style={{ color: '#5cffa8' }}>data / exit</span>
              <span style={{ color: '#ff4d4d' }}>contact sector</span>
              <span style={{ color: '#fff' }}>you</span>
            </div>
          </div>
        </div>
      )}

      {paused && phase === 'play' && (
        <div className="pon-screen">
          <h1 className="pon-title" style={{ fontSize: 'clamp(30px, 7vw, 56px)' }}>Paused</h1>
          <div className="pon-quality">
            Detail
            {QUALITIES.map((q) => (
              <button
                key={q.value}
                type="button"
                aria-pressed={quality === q.value}
                onClick={() => setQuality(q.value)}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="pon-quality">
            Sound
            <button type="button" aria-pressed={sound} onClick={() => setSound(true)}>On</button>
            <button type="button" aria-pressed={!sound} onClick={() => setSound(false)}>Off</button>
          </div>
          <div className="pon-actions">
            <button
              type="button"
              className="pon-btn"
              onClick={() => {
                setPaused(false);
                if (!coarse) setTimeout(() => gameRef.current?.requestPointerLock(), 0);
              }}
            >
              Resume
            </button>
            <button type="button" className="pon-btn ghost" onClick={retry}>
              Abandon run
            </button>
          </div>
        </div>
      )}

      {phase === 'over' && result && (
        <div className="pon-screen">
          <div className={`pon-verdict ${result.result === 'extracted' ? 'win' : 'lose'}`}>
            {result.result === 'extracted' ? 'Clean' : 'Busted'}
          </div>
          <p className="pon-body">
            {result.result === 'extracted'
              ? 'You made the stairwell. Nobody is looking for a face nobody saw.'
              : 'It did not hit you very hard. It did not have to — the sirens were already close.'}
          </p>
          <div className="pon-result-stats">
            <div>
              <b>{fmtTime(result.time)}</b>
              <span className="pon-label">inside</span>
            </div>
            <div>
              <b>{result.bag.items}</b>
              <span className="pon-label">pieces</span>
            </div>
            <div>
              <b>${(result.bag.value / 1000).toFixed(0)}k</b>
              <span className="pon-label">value</span>
            </div>
            <div>
              <b>{DIFFICULTY[result.difficulty]?.label}</b>
              <span className="pon-label">contract</span>
            </div>
          </div>
          <div className="pon-actions">
            <button type="button" className="pon-btn" onClick={beginRun}>
              Run it again
            </button>
            <button type="button" className="pon-btn ghost" onClick={retry}>
              Briefing
            </button>
            {onExit && (
              <button type="button" className="pon-btn ghost" onClick={onExit}>
                Leave
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
