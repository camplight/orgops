import { defineConfig } from "vitepress";

const repo = "https://github.com/camplight/orgops";
// docs/ stays the source of truth: some pages include files from it via
// <!--@include-->, and the implementation spec is linked on GitHub.
const repoDoc = (file: string) => `${repo}/blob/main/docs/${file}`;

export default defineConfig({
  title: "OrgOps",
  description:
    "Self-hosted control plane for teams of AI agents running across multiple machines.",
  base: "/orgops/",
  cleanUrls: true,
  lastUpdated: true,
  // Local dev URLs (http://localhost:5173 etc.) are intentional in the guides.
  ignoreDeadLinks: "localhostLinks",
  // The root package.json overrides esbuild to ^0.28 for every workspace, but
  // VitePress 1 runs on Vite 5, which expects esbuild 0.21 and cannot down-level
  // to its default es2020 target with 0.28. Building for modern browsers avoids
  // the down-level step entirely.
  vite: {
    build: { target: "esnext" },
    optimizeDeps: { esbuildOptions: { target: "esnext" } },
  },
  themeConfig: {
    nav: [
      { text: "Getting started", link: "/getting-started/installation" },
      { text: "Concepts", link: "/concepts/architecture" },
      { text: "Guides", link: "/guides/deployment" },
      { text: "Reference", link: "/reference/configuration" },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Installation", link: "/getting-started/installation" },
          { text: "Your first agent", link: "/getting-started/first-agent" },
          { text: "Use cases", link: "/getting-started/use-cases" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Architecture", link: "/concepts/architecture" },
          { text: "Agents", link: "/concepts/agents" },
          { text: "Channels and events", link: "/concepts/events" },
          { text: "Skills", link: "/concepts/skills" },
          { text: "Secrets", link: "/concepts/secrets" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Production deployment", link: "/guides/deployment" },
          { text: "Multi-host runners", link: "/guides/runners" },
          { text: "OpsCLI", link: "/guides/opscli" },
          { text: "Wrapped agents", link: "/guides/wrapped-agents" },
          { text: "Wrapped agent invites", link: "/guides/wrapped-agent-invites" },
          { text: "Embedding agents in your app", link: "/guides/embedding" },
          { text: "Deployment security", link: "/guides/deployment-security" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Configuration", link: "/reference/configuration" },
          { text: "HTTP and WebSocket API", link: "/reference/api" },
          { text: "Implementation spec", link: repoDoc("SPEC.md") },
        ],
      },
      { text: "Contributing", link: "/contributing" },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    editLink: {
      pattern: `${repo}/edit/main/apps/docs/:path`,
    },
    search: { provider: "local" },
    outline: "deep",
    footer: {
      message: "Licensed under the Apache License 2.0",
    },
  },
});
