/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // pdf-parse (and its pdfjs + native canvas renderer) breaks when webpack
    // bundles it into the server build — the pdfjs worker / native binding
    // fail at runtime. Keep these external so they're require()'d from
    // node_modules as-is, where they work. Without this, every PDF receipt
    // threw inside Next while working fine standalone.
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist', '@napi-rs/canvas'],
  },
}

module.exports = nextConfig
