import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query'
import { Toaster, toast } from 'sonner'
import { App } from './App'
import { ApiError } from './lib/api-client'
import './agents/init'
import './index.css'

// Show a toast for any uncaught query/mutation error so the user immediately
// knows when an API call has failed (e.g., server down, FK constraint, etc.).
function handleQueryError(error: unknown) {
  if (error instanceof ApiError) {
    const description = error.path ? `${error.path} → ${error.message}` : error.message
    toast.error('API error', { description, duration: Infinity })
  } else if (error instanceof Error) {
    toast.error('Unexpected error', { description: error.message, duration: Infinity })
  } else {
    toast.error('Unknown error', { duration: Infinity })
  }
}

// Catch any unhandled promise rejection — this covers direct api.* calls
// that aren't wrapped in useMutation (e.g., a delete button handler that
// just calls api.deleteSession without try/catch).
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason instanceof ApiError) {
    handleQueryError(event.reason)
    event.preventDefault()
  }
})

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleQueryError }),
  mutationCache: new MutationCache({ onError: handleQueryError }),
  defaultOptions: {
    queries: {
      staleTime: 5000,
      gcTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
)
