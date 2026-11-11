import { Component, type ReactNode } from 'react';
import { deviceInfo, diag, diagLines } from '../lib/diag';

/** Fängt Fehler beim Zeichnen der Oberfläche ab, statt eine leere Seite zu zeigen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    diag(`FEHLER (Oberfläche): ${error.message}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="picker">
        <h2>Da ist etwas schiefgelaufen</h2>
        <p className="error">{this.state.error.message}</p>
        <DiagBox lines={diagLines()} stack={this.state.error.stack} />
        <button className="btn primary big" onClick={() => location.reload()}>
          Neu laden
        </button>
      </div>
    );
  }
}

export function DiagBox({ lines, stack }: { lines: string[]; stack?: string }) {
  if (!lines.length && !stack) return null;
  return (
    <details className="diag" open>
      <summary>Diagnose (bitte als Screenshot schicken)</summary>
      <pre>
        {deviceInfo()}
        {'\n\n'}
        {lines.join('\n')}
        {stack ? `\n\n${stack.split('\n').slice(0, 6).join('\n')}` : ''}
      </pre>
    </details>
  );
}
