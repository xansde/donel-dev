import { useEffect, useState } from 'react';

const CRITERIA: Array<{ title: string; body: string }> = [
  {
    title: '1. Reproduz a forma fixada',
    body: 'eliminatório: círculos, rótulo embaixo, horizontal, cores de estado, satélites, hover com realce (lado a lado com o mockup)',
  },
  { title: '2. Identifica', body: 'estado e tipo legíveis de relance (F25)' },
  { title: '3. Navega', body: 'pan/zoom/fit fluidos, clique seleciona, hover não trava (F25)' },
  { title: '4. Bonito', body: 'veredito do dono, contra o mockup' },
  { title: '5. Integração', body: 'React 18 + Electron + tokens do design-system' },
  { title: '6. Peso', body: 'bundle e deps novas; fps com grafo grande' },
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
