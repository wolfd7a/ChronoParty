import { useEffect, useRef } from 'react';

const CELL = 8;

/**
 * The crew's tactical tablet: a cased floorplan, not a radar.
 *
 * It knows the building and where the take is, because that is what the crew
 * paid for. It does not know where the predator is — the most it will give you
 * is a smeared sector, rounded to a four-cell block, and only once it is close
 * enough that you would feel it anyway.
 */
export default function TabletMap({ level, hud }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !level) return;
    const w = level.w * CELL;
    const h = level.h * CELL;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const g = cv.getContext('2d');

    g.fillStyle = '#070b10';
    g.fillRect(0, 0, w, h);

    // floors then walls, so the plan reads as rooms rather than a bitmap
    for (let y = 0; y < level.h; y++) {
      for (let x = 0; x < level.w; x++) {
        const i = y * level.w + x;
        if (level.walls[i]) continue;
        g.fillStyle = '#152030';
        g.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    g.strokeStyle = 'rgba(125, 196, 255, 0.35)';
    g.lineWidth = 1;
    for (let y = 0; y < level.h; y++) {
      for (let x = 0; x < level.w; x++) {
        const i = y * level.w + x;
        if (!level.walls[i]) continue;
        // Only draw wall faces that touch open space — interior fill is noise.
        const open =
          (x > 0 && !level.walls[i - 1]) ||
          (x < level.w - 1 && !level.walls[i + 1]) ||
          (y > 0 && !level.walls[i - level.w]) ||
          (y < level.h - 1 && !level.walls[i + level.w]);
        if (!open) continue;
        g.fillStyle = 'rgba(96, 150, 200, 0.42)';
        g.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }

    // room labels
    g.font = '7px ui-monospace, monospace';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(150, 180, 210, 0.7)';
    for (const r of level.rects) {
      if (r.x1 - r.x0 < 5 || r.y1 - r.y0 < 5) continue;
      const cx = ((r.x0 + r.x1) / 2 + 0.5) * CELL;
      const cy = ((r.y0 + r.y1) / 2 + 0.5) * CELL;
      g.fillText(r.name.toUpperCase(), cx, cy);
    }

    // predator sector — deliberately vague
    const pr = hud?.predator;
    if (pr && pr.proximity > 0.2) {
      const px = (pr.hintX + 0.5) * CELL;
      const py = (pr.hintY + 0.5) * CELL;
      const rad = 26 + (1 - pr.proximity) * 70;
      const grd = g.createRadialGradient(px, py, 0, px, py, rad);
      const a = 0.1 + pr.proximity * 0.4;
      grd.addColorStop(0, `rgba(255, 60, 60, ${a})`);
      grd.addColorStop(1, 'rgba(255, 60, 60, 0)');
      g.fillStyle = grd;
      g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }

    // loot still in the building
    for (const l of level.loot) {
      if (l.taken) continue;
      g.fillStyle = l.kind === 'data' ? '#5cffa8' : '#e0a13a';
      g.beginPath();
      g.arc(l.x * CELL, l.y * CELL, 2.6, 0, Math.PI * 2);
      g.fill();
    }

    // extraction
    const ex = level.extraction;
    g.strokeStyle = '#5cffa8';
    g.lineWidth = 1.5;
    g.strokeRect(ex.x * CELL - 4, ex.y * CELL - 4, 8, 8);
    g.fillStyle = 'rgba(92, 255, 168, 0.25)';
    g.fillRect(ex.x * CELL - 4, ex.y * CELL - 4, 8, 8);

    // Wren
    const wren = hud?.companion;
    if (wren && wren.alive) {
      g.fillStyle = wren.state === 'downed' ? '#ff6a6a' : '#5cffa8';
      g.beginPath();
      g.arc(wren.x * CELL, wren.y * CELL, 3.4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(92,255,168,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(wren.x * CELL, wren.y * CELL, 6.5, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(160,220,190,0.85)';
      g.font = '7px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText('WREN', wren.x * CELL, wren.y * CELL - 9);
    }

    // you
    const p = hud?.player;
    if (p) {
      g.save();
      g.translate(p.x * CELL, p.y * CELL);
      g.rotate(p.angle);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(6, 0);
      g.lineTo(-4, 4);
      g.lineTo(-4, -4);
      g.closePath();
      g.fill();
      g.restore();
    }
  }, [level, hud]);

  return <canvas ref={ref} />;
}
