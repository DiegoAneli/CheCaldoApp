// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // Token dal prototipo (web/prototipo.html :root)
      colors: {
        ink:   "#16202B",
        paper: "#EAEEF2",
        card:  "#FFFFFF",
        slate: "#5A6875",
        muted: "#8B98A4",
        rule:  "#DBE2E8",
        // livelli — colori onData (fonte in lib/livelli.ts)
        lv0: "#5BD601",
        lv1: "#E4D603",
        lv2: "#FF7F02",
        lv3: "#DC2A17",
        // banda demo
        demoband: "#FFF4E3",
        demoink:  "#8A4B00",
        demorule: "#F2D6AC",
        // srcflag official
        officialbg: "#EAF2FF",
        officialink:"#0F4C8A",
        officialrule:"#C2D9F5",
        // emergenza
        emergbg:  "#FDEDEB",
        emergink: "#8A1F13",
        emergrule:"#F5D2CD",
        // warn — usato per stato "estratta" nella coda segnalazioni
        warnbg:   "#FFF8E1",
        warnink:  "#7A5B00",
        warnrule: "#F3E1A8",
        // success — usato per stato "collegata" (terminale success)
        successbg:  "#E6F5EA",
        successink: "#1F5E33",
        successrule:"#BEDFC7",
        // foot
        foot: "#F7F9FA",
      },
      fontFamily: {
        display: ["Google Sans", "system-ui", "sans-serif"],
        body:    ["Google Sans", "system-ui", "sans-serif"],
        mono:    ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        display: "-0.02em",
        logo:    "-0.035em",
        stat:    "-0.03em",
        chip:    "0.02em",
        label:   "0.07em",
      },
      borderRadius: {
        // rounded-card: 15px, contenitori (card dashboard, modal, sezioni pubblica,
        // wrapper mappa, banda allerta). Non toccare.
        // rounded-btn: 10px, bottoni e badge. Portato da 2px a 10px per addolcire
        // gli spigoli in linea con i container.
        card: "15px",
        btn:  "10px",
      },
      fontSize: {
        // scale prototipo
        "logo": "30px",
        "h2":   "19px",
      },
    },
  },
  plugins: [],
};
export default config;
