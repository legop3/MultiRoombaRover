import { Component } from 'react';

export default class AppErrorBoundary extends Component {
  state = { crashed: false, error: null, componentStack: '', copyStatus: '' };

  static getDerivedStateFromError(error) {
    return { crashed: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ componentStack: info.componentStack || '' });
  }

  getDetails() {
    const { error, componentStack } = this.state;
    return [
      String(error?.message ?? error ?? 'Unknown error'),
      'JavaScript stack:',
      error?.stack || 'Unavailable',
      'React component stack:',
      componentStack || 'Unavailable',
    ].join('\n\n');
  }

  copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(this.getDetails());
      this.setState({ copyStatus: 'Copied.' });
    } catch {
      // Clipboard access may be unavailable on the display device; the text
      // remains selectable so the error can still be copied manually.
      this.setState({ copyStatus: 'Copy unavailable. Select the details below to copy manually.' });
    }
  };

  render() {
    if (!this.state.crashed) return this.props.children;

    // Keep recovery independent of providers and shared UI components: one of
    // those dependencies may be the reason the application failed.
    return (
      <main style={{ backgroundColor: '#b2339f', minHeight: '100vh' }}>
        <h1>Application crashed</h1>
        <button type="button" onClick={this.copyDetails}>Copy details</button>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
        {this.state.copyStatus ? <p role="status">{this.state.copyStatus}</p> : null}
        <pre>{this.getDetails()}</pre>
      </main>
    );
  }
}
