import { useState } from 'react';
import { money } from '../../lib/format.js';

// Colores validados (CVD y contraste) en modo claro y oscuro: ingresos azul, gastos naranja.
export const INCOME_COLOR = '#3d7fbf';
export const EXPENSE_COLOR = '#c9731f';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const monthLabel = (ym, withYear) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}${withYear ? ` ${ym.slice(2, 4)}` : ''}`;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Columnas agrupadas ingresos / gastos por mes, con tooltip y vista de tabla. */
export function MonthlyChart({ data }) {
  const [tip, setTip] = useState(null);
  const [table, setTable] = useState(false);
  if (!data.length) return <p className="faint small" style={{ padding: 16 }}>Sin movimientos en este periodo.</p>;
  const max = niceMax(Math.max(...data.flatMap((d) => [d.income, d.expense])));
  const H = 200;
  const padL = 56;
  const padB = 24;
  const bar = Math.min(24, Math.max(6, Math.floor(560 / data.length / 2.6)));
  const group = bar * 2 + 2;
  const slot = Math.max(group + 14, 44);
  const W = padL + slot * data.length + 8;
  const y = (v) => H - padB - (v / max) * (H - padB - 8);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const multiYear = new Set(data.map((d) => d.month.slice(0, 4))).size > 1;
  const r = 4;
  const rounded = (x, top, w, bottom) => {
    const h = bottom - top;
    if (h <= 0) return '';
    const rr = Math.min(r, h);
    return `M${x},${bottom} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + w - rr} Q${x + w},${top} ${x + w},${top + rr} V${bottom} Z`;
  };
  return (
    <div>
      <div className="flex between mb-2">
        <div className="legend">
          <span><span className="swatch" style={{ background: INCOME_COLOR }} />Ingresos</span>
          <span><span className="swatch" style={{ background: EXPENSE_COLOR }} />Gastos</span>
        </div>
        <button className="link small" onClick={() => setTable(!table)}>{table ? 'Ver gráfica' : 'Ver tabla'}</button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Mes</th><th className="right">Ingresos</th><th className="right">Gastos</th><th className="right">Balance</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month}><td>{monthLabel(d.month, true)}</td><td className="right num">{money(d.income)}</td><td className="right num">{money(d.expense)}</td><td className={`right num ${d.income - d.expense < 0 ? 'neg' : ''}`}>{money(d.income - d.expense)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} style={{ minWidth: Math.min(W, 320), maxWidth: W, height: H }} role="img" aria-label="Ingresos y gastos por mes">
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid-line" x1={padL} x2={W} y1={y(t)} y2={y(t)} />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end">{money(t, { compact: true }).replace(/\.00$/, '')}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = padL + i * slot + (slot - group) / 2;
              const base = y(0);
              return (
                <g key={d.month}>
                  <path d={rounded(x0, y(d.income), bar, base)} fill={INCOME_COLOR} />
                  <path d={rounded(x0 + bar + 2, y(d.expense), bar, base)} fill={EXPENSE_COLOR} />
                  {/* Zona de interacción mayor que las barras */}
                  <rect
                    x={padL + i * slot}
                    y={0}
                    width={slot}
                    height={H - padB}
                    fill="transparent"
                    onMouseMove={(e) => setTip({ d, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setTip(null)}
                    onClick={(e) => setTip({ d, x: e.clientX, y: e.clientY })}
                  />
                  <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle">{monthLabel(d.month, multiYear)}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {tip && (
        <div className="chart-tip" style={{ left: Math.min(tip.x + 12, window.innerWidth - 190), top: tip.y + 12 }}>
          <div className="strong mb-2" style={{ textTransform: 'capitalize' }}>{monthLabel(tip.d.month, true)}</div>
          <div className="flex between" style={{ gap: 16 }}><span className="flex" style={{ gap: 6 }}><span className="swatch" style={{ background: INCOME_COLOR }} />Ingresos</span><span className="num">{money(tip.d.income)}</span></div>
          <div className="flex between" style={{ gap: 16 }}><span className="flex" style={{ gap: 6 }}><span className="swatch" style={{ background: EXPENSE_COLOR }} />Gastos</span><span className="num">{money(tip.d.expense)}</span></div>
          <div className="flex between mt-1" style={{ gap: 16, borderTop: '1px solid var(--border)', paddingTop: 4 }}><span>Balance</span><span className={`num strong ${tip.d.income - tip.d.expense < 0 ? 'neg' : ''}`}>{money(tip.d.income - tip.d.expense)}</span></div>
        </div>
      )}
    </div>
  );
}

/** Barras horizontales por categoría: una sola medida, etiquetas en texto. */
export function CategoryBars({ rows, total, color = EXPENSE_COLOR, empty = 'Sin datos en este periodo.' }) {
  if (!rows.length) return <p className="faint small" style={{ padding: '8px 0' }}>{empty}</p>;
  const max = Math.max(...rows.map((r) => r.total));
  return (
    <div className="cat-bar">
      {rows.map((r) => (
        <div key={`${r.category_id ?? r.name}`} className="cat-row" title={`${r.name}: ${money(r.total)} (${total ? Math.round((r.total / total) * 100) : 0}%)`}>
          <div className="cat-line">
            <span className="truncate">{r.name}</span>
            <span className="num muted">{money(r.total)} <span className="faint">· {total ? Math.round((r.total / total) * 100) : 0}%</span></span>
          </div>
          <div className="cat-track"><div className="cat-fill" style={{ width: `${(r.total / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}
