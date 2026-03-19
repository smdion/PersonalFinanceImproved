"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="bg-surface-primary rounded-lg border border-red-200 p-4 shadow-sm">
          <p className="text-sm text-red-600">Something went wrong.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 text-xs text-blue-600 hover:text-blue-800"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
