import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from '@/api/client';
import { App } from '@/App';
import { AuthProvider } from '@/auth/AuthProvider';
import { ToastProvider } from '@/components/ui/toast';
import { preloadLogos } from '@/lib/logoCache';
// The UOS shell's fonts, self-hosted: Plus Jakarta Sans for text, IBM Plex Mono for figures.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
// Inter: only the on-screen agreement preview (features/vendors/documents.ts) is set in it.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import './index.css';

// Print documents need the campus logos inlined (see lib/logoCache.ts).
preloadLogos(['/assets/logo_smgg.png', '/assets/logo_smwec.jpg']);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // Never retry auth/permission/validation errors.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
