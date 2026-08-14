// SPDX-License-Identifier: AGPL-3.0-or-later
export function Masthead({ sottotitolo }: { sottotitolo?: string }) {
  return (
    <header className="flex items-baseline gap-3 flex-wrap mb-1">
      <div className="font-display font-bold text-logo tracking-logo">
        Che<span className="text-lv2">Caldo!</span>
      </div>
      {sottotitolo && <div className="text-slate text-sm">{sottotitolo}</div>}
    </header>
  );
}
