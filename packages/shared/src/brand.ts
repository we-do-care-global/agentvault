// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

export const BRAND = {
  org: "We Do Care Global",
  orgShort: "WDC",
  product: "AgentVault",
  author: "Perla, Emir",
  authorDisplay: "Founder Perla Emir",
  email: "emirperla96@gmail.com",
  orcid: "0009-0009-8515-2727",
  affiliation: "We Do Care Global",
  location: "Sarajevo, Bosnia and Herzegovina",
  githubOrg: "we-do-care-global",
  github: "https://github.com/we-do-care-global/agentvault",
  site: "https://we-do-care-global.github.io/agentvault/",
  npmScope: "@we-do-care",
  /** Palette derived from the WDC seal: navy field, gold ring, champagne text. */
  colors: {
    ink:   "#0a0b10",   // page background
    card:  "#14161f",   // card surface
    border:"#232635",   // hairline border
    gold:  "#d9a95f",   // primary accent
    text:  "#e8eaf2",   // primary text
    muted: "#8b90a6",   // muted text
    navy:  "#1a1206",   // text on gold
  },
  fonts: {
    ui: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    serif: "'Instrument Serif', Georgia, serif",
    mono: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  license: "Apache-2.0",
  version: "0.1.3",
  logo: "assets/logo.jpg",
} as const;

export const LICENSE_HEADER = [
  "SPDX-License-Identifier: Apache-2.0",
  "Copyright (c) 2026 We Do Care Global",
  "Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727",
].join("\n");
