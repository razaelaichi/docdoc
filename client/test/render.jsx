import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthProvider } from "../src/auth.jsx";
import Root from "../src/components/Root.jsx";
import RouteError from "../src/components/RouteError.jsx";
import { ToastProvider } from "../src/components/Toaster.jsx";

// Renders routes with the real providers (auth, react-query, toasts) against the MSW fake API.
export function renderApp(routes, { at = "/" } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ Component: Root, ErrorBoundary: RouteError, children: routes }], { initialEntries: [at] });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
  return { ...utils, router, queryClient };
}
