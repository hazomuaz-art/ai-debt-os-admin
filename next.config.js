/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 16: the `eslint` config option was removed entirely (next build
  // no longer runs lint at all, next-lint-to-eslint-cli codemod already
  // migrated `npm run lint` to the standalone ESLint CLI) — nothing to
  // replace this with, ignoreDuringBuilds is simply a no-op now.
  typescript: {
    ignoreBuildErrors: true,
  },
  // pdf-parse (and its pdfjs + native canvas renderer) breaks when webpack
  // bundles it into the server build — the pdfjs worker / native binding
  // fail at runtime. Keep these external so they're require()'d from
  // node_modules as-is, where they work. Without this, every PDF receipt
  // threw inside Next while working fine standalone.
  // Next.js 15: experimental.serverComponentsExternalPackages -> stable serverExternalPackages.
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', '@napi-rs/canvas'],
}

module.exports = nextConfig
