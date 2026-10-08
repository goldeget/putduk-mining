/** Critical offline CSS travels inside the cached public document. */
export const offlineShellStyles = `
.putduk-offline{--off-bg:#07101e;--off-panel:#101c2d;--off-ink:#f1f4f8;--off-muted:#b0bed0;--off-line:#536178;min-height:100svh;display:grid;place-items:center;padding:clamp(16px,5vw,48px);background:var(--off-bg);color:var(--off-ink);font-family:var(--font-sans),system-ui,sans-serif;word-break:keep-all;overflow-wrap:normal}
.putduk-offline *{box-sizing:border-box}.putduk-offline__card{display:grid;justify-items:center;gap:20px;width:min(100%,620px);padding:clamp(20px,5vw,48px);border:1px solid var(--off-line);border-radius:28px;background:var(--off-panel);text-align:center}
.putduk-offline img{width:min(160px,50%);height:auto;object-fit:contain}.putduk-offline h1{margin:0;font-size:clamp(1.3rem,4vw,2rem);line-height:1.45;font-weight:800;letter-spacing:-.035em}.putduk-offline p{margin:0;max-width:32ch;font-size:1rem;line-height:1.7;color:var(--off-muted)}
.putduk-offline a{display:inline-flex;align-items:center;justify-content:center;gap:10px;max-width:100%;min-height:48px;padding:14px 24px;border:1px solid #ddbd76;border-radius:14px;background:#f0c76d;color:#201b10;font-size:1rem;font-weight:750;text-decoration:none;line-height:1.5}.putduk-offline a:focus-visible{outline:3px solid #7cadff;outline-offset:4px}.putduk-offline svg{flex-shrink:0}.putduk-offline__brand{font-size:.875rem;font-weight:700;letter-spacing:.03em;color:#e9c777}
@media(prefers-color-scheme:light){html:not([data-theme=dark]) .putduk-offline{--off-bg:#f3f5f8;--off-panel:#fff;--off-ink:#162336;--off-muted:#4b5b70;--off-line:#a5afbe}}
html[data-theme=light] .putduk-offline{--off-bg:#f3f5f8;--off-panel:#fff;--off-ink:#162336;--off-muted:#4b5b70;--off-line:#a5afbe}
@media(forced-colors:active){.putduk-offline,.putduk-offline__card{background:Canvas;color:CanvasText}.putduk-offline a{border:1px solid ButtonText;background:ButtonFace;color:ButtonText}}
`;
