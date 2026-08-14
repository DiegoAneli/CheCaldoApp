/** @type {import('next').NextConfig} */
const path = require("node:path");

const nextConfig = {
  reactStrictMode: true,
  // Il monorepo ha sorgenti TS in packages/*/src consumate come workspace deps
  // ("main": "src/index.ts"): trasponi da qui.
  transpilePackages: ["@checaldo/scoring", "@checaldo/db"],
  // §12xxxx — output autoconsistente per l'immagine di produzione.
  // Next produce apps/web/.next/standalone/server.js + un node_modules
  // ridotto con le sole dep tracciate. Il Dockerfile di produzione
  // (docker/web.Dockerfile stage `runner`) copia standalone/ + .next/static
  // + public/ in un'immagine finale ~300-400 MB, contro ~1.4 GB portandosi
  // tutti i node_modules dei workspace.
  output: "standalone",
  // Monorepo pnpm: senza questo, il tracer di Next parte da apps/web e
  // non risale ai simlink dei workspace `@checaldo/*` che vivono due
  // livelli sopra (link:../../packages/agents ecc. in pnpm-lock.yaml).
  // Il risultato sarebbe uno standalone senza le dep dei package interni
  // e crash a runtime alla prima import. Path assoluto della root del
  // monorepo, calcolato dal file config stesso.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Bind mount + HMR in Docker: file watching via polling.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = { poll: 800, aggregateTimeout: 300, ignored: ["**/node_modules/**"] };
    }
    return config;
  },
};
module.exports = nextConfig;
