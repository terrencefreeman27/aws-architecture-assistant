import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';

interface Props {
  source: string;
  title: string;
}

type MermaidApi = typeof import('mermaid')['default'];
let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      // Plain SVG text (no foreignObject) keeps the exported SVG self-contained.
      htmlLabels: false,
      flowchart: { htmlLabels: false, curve: 'basis', padding: 12, nodeSpacing: 36, rankSpacing: 56 },
      themeVariables: {
        primaryColor: '#ffffff',
        primaryBorderColor: '#ff9900',
        primaryTextColor: '#16191f',
        lineColor: '#5f6b7a',
        clusterBkg: '#f8f9fb',
        clusterBorder: '#d5dbe3',
        edgeLabelBackground: '#ffffff',
        fontSize: '14px',
      },
    });
    return mermaid;
  });
  return mermaidPromise;
}

export function DiagramCanvas({ source, title }: Props) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [fit, setFit] = useState(true);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const counter = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const renderId = `diagram-${reactId}-${++counter.current}`;
    setError('');
    loadMermaid()
      .then((mermaid) => mermaid.render(renderId, source))
      .then(({ svg: out }) => {
        if (cancelled) return;
        // Mermaid records the diagram's natural width as an inline max-width.
        const match = /max-width:\s*([\d.]+)px/.exec(out);
        setNaturalWidth(match ? Math.ceil(Number(match[1])) : 0);
        setSvg(out);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSvg('');
          setError(err instanceof Error ? err.message : 'The diagram could not be rendered.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [source, reactId]);

  const exportSvg = () => {
    if (!svg) return;
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'architecture'}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="canvas-card">
      <div className="canvas-toolbar">
        <span className="canvas-label">Architecture diagram</span>
        <div className="toolbar-actions">
          <button type="button" className="btn-quiet" onClick={() => setFit((v) => !v)} aria-pressed={fit} disabled={!svg}>
            {fit ? 'Actual size' : 'Fit to width'}
          </button>
          <button type="button" className="btn-quiet" onClick={() => setShowSource((v) => !v)} aria-expanded={showSource}>
            {showSource ? 'Hide source' : 'Mermaid source'}
          </button>
          <button type="button" className="btn-secondary" onClick={exportSvg} disabled={!svg} data-testid="export-svg">
            Export SVG
          </button>
        </div>
      </div>
      {error ? (
        <div className="canvas-error" role="alert">
          The diagram failed to render: {error}
        </div>
      ) : svg ? (
        <div
          className={`canvas${fit ? ' is-fit' : ''}`}
          data-testid="diagram"
          style={naturalWidth ? ({ '--diagram-width': `${naturalWidth}px` } as CSSProperties) : undefined}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="canvas canvas-loading" aria-busy="true">
          Rendering diagram...
        </div>
      )}
      {showSource && (
        <pre className="mermaid-source" aria-label="Generated Mermaid source">
          {source}
        </pre>
      )}
      <p className="canvas-foot">Drawn from validated components and connections. The model never writes diagram code.</p>
    </div>
  );
}
