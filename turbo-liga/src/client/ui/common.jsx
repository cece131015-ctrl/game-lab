import { createContext, useContext } from 'react';
import { useStore } from '../store.js';

export const EngineContext = createContext(null);

export function useEngine() {
  return useContext(EngineContext);
}

// Lee una parte del estado del motor
export function useGame(selector) {
  const engine = useEngine();
  return useStore(engine.store, selector);
}

// Control segmentado (botones excluyentes)
export function Seg({ name, value, options, onChange, disabled = false, setting = false }) {
  const dataAttr = setting ? { 'data-setting': name } : { 'data-opt': name };
  return (
    <div className="seg" {...dataAttr}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          data-v={String(o.value)}
          className={`${String(o.value) === String(value) ? 'on' : ''} ${o.cls || ''}`}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, inline = false }) {
  return (
    <div className={`field ${inline ? 'inline' : ''}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Screen({ name, children, className = 'panel' }) {
  return (
    <section className={`screen active ${className}`} data-screen={name}>
      {children}
    </section>
  );
}

export function StatsTable({ players, localId }) {
  const blue = players.filter((p) => p.team === 0).sort((a, b) => b.points - a.points);
  const orange = players.filter((p) => p.team === 1).sort((a, b) => b.points - a.points);
  const row = (p) => (
    <tr key={p.id} className={`${p.team === 0 ? 'b' : 'o'} ${p.id === localId ? 'me' : ''}`}>
      <td>{p.name}</td><td>{p.points}</td><td>{p.goals}</td><td>{p.assists}</td><td>{p.saves}</td><td>{p.shots}</td><td>{p.demos}</td>
    </tr>
  );
  return (
    <table className="stats">
      <thead>
        <tr><th>Jugador</th><th>Puntos</th><th>Goles</th><th>Asist.</th><th>Paradas</th><th>Tiros</th><th>Demos</th></tr>
      </thead>
      <tbody>
        {blue.map(row)}
        <tr className="sep"><td colSpan={7} /></tr>
        {orange.map(row)}
      </tbody>
    </table>
  );
}

export const DIFFICULTY_OPTIONS = [
  { value: 'rookie', label: 'Principiante' },
  { value: 'pro', label: 'Pro' },
  { value: 'allstar', label: 'Leyenda' },
];

export const TEAM_SIZE_OPTIONS = [
  { value: 1, label: '1 vs 1' },
  { value: 2, label: '2 vs 2' },
  { value: 3, label: '3 vs 3' },
];

export const TIME_OPTIONS = [
  { value: 180, label: '3 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
];
