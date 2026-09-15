import React from 'react';

interface Props { children: React.ReactNode; fallback?: React.ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.children !== this.props.children && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="empty-state">
            <div className="empty-icon">💥</div>
            <h2>Something broke while rendering</h2>
            <p className="muted">{this.state.error.message}</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
