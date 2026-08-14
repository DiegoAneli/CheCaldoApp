// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Icona telefono riutilizzabile (stile lucide, stroke currentColor).
 * SVG inline, aria-hidden: il ruolo semantico va sull'elemento
 * cliccabile (aria-label o testo `sr-only`), non sull'icona.
 * Stesso path SVG usato dall'IconaTelefono locale di
 * `raccomandazioni.tsx` (non riesportata da lì per non introdurre
 * dip cross-file: quel componente ha 5 icone tutte private).
 */
type Props = { className?: string; size?: number };

export function IconaTelefono({ className, size = 20 }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
