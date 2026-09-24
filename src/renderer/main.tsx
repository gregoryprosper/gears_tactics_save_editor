import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
class ErrorBoundary extends React.Component<React.PropsWithChildren, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h1>The interface could not render</h1>
        <p>{this.state.error}</p>
        <p>Your save has not been written. Restart the application to reload it.</p>
      </div>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
