import { useEffect, useState } from 'react';

const CRITERIA: Array<{ title: string; body: string }> = [
  { title: 'Identifica', body: 'tipo de nó legível de relance' },
  { title: 'Navega', body: 'pan/zoom/fit fluidos, clique leva ao nó' },
  { title: 'Bonito', body: 'veredito estético do dono' },
  { title: 'Auto-layout', body: '12 nós sem sobreposição, sem coordenada à mão' },
  { title: 'Integração', body: 'custo de trazer pro Modo Dev (React 18 + Electron, tema do design-system)' },
  { title: 'Peso', body: 'bundle e dependências novas' },
];

export type TabId = 'A' | 'B' | 'C';

interface CriteriaProps {
  tab: TabId;
}

function storageKey(tab: TabId): string {
  return `bancada-mapa-grafos:anotacao:${tab}`;
}

export function Criteria({ tab }: CriteriaProps) {
  const [note, setNote] = useState('');

  useEffect(() => {
    setNote(localStorage.getItem(storageKey(tab)) ?? '');
  }, [tab]);

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setNote(value);
    localStorage.setItem(storageKey(tab), value);
  }

  return (
    <div className="panel">
      <h2>Régua de avaliação</h2>
      <ul className="criteria-list">
        {CRITERIA.map((criterion) => (
          <li key={criterion.title}>
            <strong>{criterion.title}</strong> — {criterion.body}
          </li>
        ))}
      </ul>
      <textarea
        className="criteria-textarea"
        placeholder={`Anotações da aba ${tab}...`}
        value={note}
        onChange={handleChange}
        aria-label={`Anotação da aba ${tab}`}
      />
    </div>
  );
}
