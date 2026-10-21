import { useEffect, useState } from 'react';
import type { PetView } from '../../../shared/pet/types';
import styles from './PetApp.module.css';

/**
 * T017 (015-jobu-pet) — esqueleto da tela do Jobu: só assina a vista e avisa o main que está pronto.
 * O desenho das poses, o selo, o balão, a lista, o arraste e o menu entram com as user stories
 * (T028, T034, T039, T046...); este componente já deixa o encaixe delas:
 *   - a vista (`PetView`) é a ÚNICA fonte do que se mostra: nada aqui decide estado;
 *   - os `data-*` do elemento raiz espelham a vista e são a superfície do smoke `@pet`
 *     (contracts/ipc-pet.md, "Regras").
 */
export function PetApp(): React.JSX.Element {
  const [view, setView] = useState<PetView | null>(null);

  useEffect(() => {
    // Assina ANTES de avisar: o main responde ao `ready` com a vista atual, e uma resposta que
    // chegasse sem assinante seria perdida.
    const unsubscribe = window.donel.pet.onView(setView);
    window.donel.pet.ready();
    return unsubscribe;
  }, []);

  return (
    <div
      className={styles.root}
      data-testid="pet-root"
      data-pose={view?.pose ?? 'sleeping'}
      data-badge={view?.badge ?? undefined}
      data-bubble={view?.bubble?.text ?? undefined}
      data-docked={view === null ? undefined : String(view.docked)}
      data-align={view?.align}
      data-size={view === null ? undefined : String(view.size)}
    >
      {/* Marcador provisório da Fase 2: o desenho do Jobu (T028) toma o lugar dele. */}
      <div className={styles.placeholder} aria-hidden="true" />
    </div>
  );
}
