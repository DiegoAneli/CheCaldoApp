/**
 * Avviso 112. Deve dire inequivocabilmente che questo non è un
 * servizio di emergenza — altrimenti qualcuno lo userà come tale.
 *
 * Stile: bordo rosso scuro marcato (2px, emergink) + fondo rosa
 * chiaro. NO rosso pieno con testo bianco: il badge di allerta
 * livello 3 è già rosso saturo, e un blocco rosso pieno leggerebbe
 * "emergenza in corso" — mentre il testo dice l'opposto.
 * Contenuto centrato, "112" grande e cliccabile (tel:112), padding
 * generoso. Occupa la larghezza piena del contenitore in cui è
 * montato (oggi: la SezioneMappa, sotto la card della mappa).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export function AvvisoEmrg() {
  return (
    <div
      role="note"
      className="w-full border-2 border-emergink border-red-400 bg-emergbg text-emergink rounded-card px-6 py-6 text-center"
    >
      <p className="text-[16px] leading-normal">
        Per emergenze chiama subito i servizi sanitari.
      </p>
    </div>
  );
}
