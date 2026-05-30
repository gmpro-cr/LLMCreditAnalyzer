import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-background">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {this.state.error.message || "An unexpected error occurred. Try reloading the page."}
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={this.reset}>Try Again</Button>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Reload Page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
