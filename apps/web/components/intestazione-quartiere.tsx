// SPDX-License-Identifier: AGPL-3.0-or-later

interface Props {
  /** Riga superiore piccola, uppercase, muted (es. "Il quartiere"). */
  sopratitolo: string;
  /** Titolo grande sotto il sopratitolo (es. nome del quartiere). */
  nome: string;
  /**
   * Riga opzionale di metadati sotto il nome, resa in `font-mono
   * tabular-nums`. Serve al blocco Profilo per stampare "N sezioni · N
   * abitanti · N famiglie"; nella card "Vicini al centro" è assente.
   */
  meta?: React.ReactNode;
}

/**
 * Intestazione di card che identifica un quartiere: due righe (sopratitolo
 * + nome), più una terza opzionale di metadati. Estratta da
 * `ProfiloQuartiere` — dov'era inline — per essere riusata anche nella
 * card "Vicini al centro del quartiere", così le due intestazioni
 * restano allineate tipograficamente in un solo punto.
 */
export function IntestazioneQuartiere({ sopratitolo, nome, meta }: Props) {
  return (
    <div className="px-5 pt-4 pb-3 border-b border-rule">
      <div className="font-display font-semibold text-[11.5px] tracking-label uppercase text-muted">
        {sopratitolo}
      </div>
      <div className="font-display font-bold text-[24px] mt-0.5">{nome}</div>
      {meta && (
        <div className="text-[12.5px] text-slate font-mono mt-1 tabular-nums">
          {meta}
        </div>
      )}
    </div>
  );
}
