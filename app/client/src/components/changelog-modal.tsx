import { useState, useEffect } from 'react'
import Markdown from 'react-markdown'
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Github, X, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api-client'
import { isNewerVersion } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

interface ChangelogModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const mdComponents = {
  h2: ({ children, ...props }: React.ComponentProps<'h2'>) => (
    <h2 className="text-lg font-semibold mt-6 first:mt-0 mb-2 pt-4 first:pt-0 border-t first:border-t-0 border-foreground/20" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }: React.ComponentProps<'h3'>) => (
    <h3 className="text-base font-semibold mt-4 mb-1.5 text-foreground" {...props}>{children}</h3>
  ),
  ul: ({ children, ...props }: React.ComponentProps<'ul'>) => (
    <ul className="list-disc pl-5 space-y-1" {...props}>{children}</ul>
  ),
  li: ({ children, ...props }: React.ComponentProps<'li'>) => (
    <li className="text-sm" {...props}>{children}</li>
  ),
  p: ({ children, ...props }: React.ComponentProps<'p'>) => (
    <p className="text-sm mb-2 text-muted-foreground" {...props}>{children}</p>
  ),
  hr: (props: React.ComponentProps<'hr'>) => (
    <hr className="my-4 border-border" {...props} />
  ),
}

export function ChangelogModal({ open, onOpenChange }: ChangelogModalProps) {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const latestVersion = useUIStore((s) => s.latestVersion)
  const serverVersion = useUIStore((s) => s.serverVersion)

  useEffect(() => {
    if (open && markdown === null && !error) {
      api.getChangelog()
        .then((data) => setMarkdown(data.markdown.replace(/^#\s+Changelog\s*\n+/, '')))
        .catch(() => setError(true))
    }
  }, [open, markdown, error])

  const versionMismatch = serverVersion ? serverVersion !== __APP_VERSION__ : false
  const outdated = latestVersion && isNewerVersion(__APP_VERSION__, latestVersion)
  const changelogUrl = __GITHUB_REPO_URL__ ? `${__GITHUB_REPO_URL__}/blob/main/CHANGELOG.md` : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[700px] max-w-[90vw] max-h-[80vh] flex flex-col p-0">
        <div className="flex items-center px-6 pt-6 pb-0">
          <DialogTitle>Changelog</DialogTitle>
          <span className="ml-2 text-xs text-muted-foreground">v{__APP_VERSION__}</span>
          {latestVersion && !versionMismatch && !outdated && (
            <span className="ml-1.5 text-[10px] text-green-600 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded-full">up to date</span>
          )}
          <div className="flex items-center gap-1 ml-auto">
            {__GITHUB_REPO_URL__ && (
              <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                <a href={__GITHUB_REPO_URL__} target="_blank" rel="noopener noreferrer" title="View on GitHub">
                  <Github className="h-4 w-4" />
                </a>
              </Button>
            )}
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Close">
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
          </div>
        </div>

        {versionMismatch && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-sm">
            <span className="text-red-600 dark:text-red-400">
              Version mismatch: the dashboard is <strong>v{__APP_VERSION__}</strong> but the server is <strong>v{serverVersion}</strong>. Some features may not work correctly. Restart the server or reinstall the plugin to fix this.
              {__GITHUB_REPO_URL__ && (
                <> See the <a href={__GITHUB_REPO_URL__} target="_blank" rel="noopener noreferrer" className="underline hover:text-red-500 dark:hover:text-red-300">README</a> for details.</>
              )}
            </span>
          </div>
        )}

        {outdated && changelogUrl && !versionMismatch && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-sm flex items-start gap-2">
            <span className="text-yellow-600 dark:text-yellow-400">
              A newer version is available: <strong>v{latestVersion}</strong> (you're running v{__APP_VERSION__}).
            </span>
            <a
              href={changelogUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-yellow-700 dark:text-yellow-300 hover:underline whitespace-nowrap shrink-0"
            >
              View changelog <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
          {markdown === null && !error && (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}
          {error && (
            <p className="text-sm text-destructive">Failed to load changelog.</p>
          )}
          {markdown && (
            <Markdown components={mdComponents}>{markdown}</Markdown>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
