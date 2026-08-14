// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Icona del sole condivisa. Prima esisteva duplicata in `navbar.tsx`
 * e `navbar-landing.tsx`; un terzo uso (nell'h1 di `app/page.tsx` per
 * la parola "quando arriva la prossima") ha reso necessario estrarla
 * in un componente unico invece di triplicare l'SVG.
 *
 * Colore via `currentColor`: chi la include scrive `className="text-…"`
 * e stroke segue. Dimensione via className (default 28 px come nella
 * navbar; l'h1 la usa a `h-[0.85em] w-[0.85em]` così scala col
 * font-size responsive senza fissare pixel).
 */

interface Props {
  className?: string;
}

export function IconaSole({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
