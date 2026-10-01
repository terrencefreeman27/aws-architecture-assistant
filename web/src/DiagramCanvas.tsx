import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { downloadText } from './download';
import { isNarrow } from './options';

interface Props {
  /** Mermaid source with AWS icon shapes (needs the bundled icon pack). */
  iconSource: string;
  /** Portable Mermaid source without icons: shown to the user and used if the icon pack fails to load. */
  portableSource: string;
  title: string;
}

type MermaidApi = typeof import('mermaid')['default'];
let mermaidPromise: Promise<{ mermaid: MermaidApi; icons: boolean }> | null = null;

function loadMermaid(): Promise<{ mermaid: MermaidApi; icons: boolean }> {
  mermaidPromise ??= import('mermaid').then(async ({ default: mermaid }) => {
    // The icon pack is bundled (no network). If it fails to load, diagrams fall back to plain boxes.
    let icons = false;
    try {
      const { awsIconPack } = await import('./awsIconPack');
      mermaid.registerIconPacks([{ name: awsIconPack.prefix, icons: awsIconPack }]);
      icons = true;
    } catch {
      icons = false;
    }
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
    return { mermaid, icons };
  });
  return mermaidPromise;
}

export function DiagramCanvas({ iconSource, portableSource, title }: Props) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [showSource, setShowSource] = useState(false);
  // Phones start at actual size (scroll sideways) because fit-to-width makes the labels unreadably small.
  const [fit, setFit] = useState(() => !isNarrow());
  const [naturalWidth, setNaturalWidth] = useState(0);
  const counter = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const renderId = `diagram-${reactId}-${++counter.current}`;
    setError('');
    loadMermaid()
      .then(({ mermaid, icons }) => mermaid.render(renderId, icons ? iconSource : portableSource))
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
  }, [iconSource, portableSource, reactId]);

  // Icons are inline SVG inside the diagram, so the exported file is self-contained.
  const exportSvg = () => {
    if (!svg) return;
    const name = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'architecture'}.svg`;
    downloadText(name, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, 'image/svg+xml');
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
          {portableSource}
        </pre>
      )}
      {svg && !fit && (
        <p className="canvas-scroll-hint" data-testid="diagram-scroll-hint">
          Shown at actual size. Scroll sideways to see the whole diagram, or choose Fit to width.
        </p>
      )}
      <p className="canvas-foot">
        Drawn from validated components and connections. The model never writes diagram code. Service icons are the official AWS Architecture Icons; the Mermaid source leaves them out so it renders in any Mermaid viewer.
      </p>
    </div>
  );
}
