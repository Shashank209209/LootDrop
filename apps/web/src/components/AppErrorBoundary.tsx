import { Component, type PropsWithChildren } from 'react';

export class AppErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page-shell">
        <div className="page-inner request-state error-state" role="alert">
          <h1>Something went wrong</h1>
          <p>We couldn’t load this page. Return to the deals page to try again.</p>
          <a className="ghost-button" href="/">
            Back to deals
          </a>
        </div>
      </main>
    );
  }
}
