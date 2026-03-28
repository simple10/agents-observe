/**
 * Curated catalog of lucide-react icons available for user customization.
 * Organized by category for easy browsing in the icon picker.
 *
 * Each entry is a PascalCase name matching the lucide-react export.
 * Icons are loaded dynamically via the `icons` namespace from lucide-react.
 */

export interface IconCatalogEntry {
  name: string
  category: string
}

export const ICON_CATALOG: IconCatalogEntry[] = [
  // Arrows & Navigation
  { name: 'ArrowRight', category: 'Arrows' },
  { name: 'ArrowLeft', category: 'Arrows' },
  { name: 'ArrowUp', category: 'Arrows' },
  { name: 'ArrowDown', category: 'Arrows' },
  { name: 'ArrowUpRight', category: 'Arrows' },
  { name: 'ArrowDownRight', category: 'Arrows' },
  { name: 'MoveRight', category: 'Arrows' },
  { name: 'Undo', category: 'Arrows' },
  { name: 'Redo', category: 'Arrows' },
  { name: 'RefreshCw', category: 'Arrows' },

  // Status & Feedback
  { name: 'CircleCheck', category: 'Status' },
  { name: 'CircleX', category: 'Status' },
  { name: 'CircleAlert', category: 'Status' },
  { name: 'CircleHelp', category: 'Status' },
  { name: 'CircleDot', category: 'Status' },
  { name: 'CircleStop', category: 'Status' },
  { name: 'Check', category: 'Status' },
  { name: 'X', category: 'Status' },
  { name: 'AlertTriangle', category: 'Status' },
  { name: 'Info', category: 'Status' },
  { name: 'Ban', category: 'Status' },
  { name: 'ShieldCheck', category: 'Status' },
  { name: 'ShieldAlert', category: 'Status' },

  // Communication
  { name: 'MessageSquare', category: 'Communication' },
  { name: 'MessageSquareReply', category: 'Communication' },
  { name: 'MessageCircle', category: 'Communication' },
  { name: 'Mail', category: 'Communication' },
  { name: 'Send', category: 'Communication' },
  { name: 'Bell', category: 'Communication' },
  { name: 'BellRing', category: 'Communication' },
  { name: 'Megaphone', category: 'Communication' },

  // Files & Documents
  { name: 'File', category: 'Files' },
  { name: 'FileText', category: 'Files' },
  { name: 'FilePen', category: 'Files' },
  { name: 'FileCode', category: 'Files' },
  { name: 'FileCheck', category: 'Files' },
  { name: 'FileX', category: 'Files' },
  { name: 'FilePlus', category: 'Files' },
  { name: 'FolderOpen', category: 'Files' },
  { name: 'Folder', category: 'Files' },
  { name: 'FolderPlus', category: 'Files' },
  { name: 'ClipboardList', category: 'Files' },
  { name: 'Clipboard', category: 'Files' },

  // Tools & Actions
  { name: 'Wrench', category: 'Tools' },
  { name: 'Hammer', category: 'Tools' },
  { name: 'Cog', category: 'Tools' },
  { name: 'Settings', category: 'Tools' },
  { name: 'SlidersHorizontal', category: 'Tools' },
  { name: 'Pencil', category: 'Tools' },
  { name: 'Eraser', category: 'Tools' },
  { name: 'Scissors', category: 'Tools' },
  { name: 'Trash', category: 'Tools' },
  { name: 'Trash2', category: 'Tools' },
  { name: 'Filter', category: 'Tools' },

  // Energy & Activity
  { name: 'Zap', category: 'Energy' },
  { name: 'Flame', category: 'Energy' },
  { name: 'Rocket', category: 'Energy' },
  { name: 'Bomb', category: 'Energy' },
  { name: 'Sparkles', category: 'Energy' },
  { name: 'Activity', category: 'Energy' },
  { name: 'Bolt', category: 'Energy' },
  { name: 'Timer', category: 'Energy' },
  { name: 'Hourglass', category: 'Energy' },
  { name: 'Clock', category: 'Energy' },

  // People & Users
  { name: 'User', category: 'People' },
  { name: 'Users', category: 'People' },
  { name: 'UserPlus', category: 'People' },
  { name: 'UserCheck', category: 'People' },
  { name: 'Bot', category: 'People' },
  { name: 'Brain', category: 'People' },
  { name: 'Cpu', category: 'People' },

  // Search & Explore
  { name: 'Search', category: 'Search' },
  { name: 'SearchCode', category: 'Search' },
  { name: 'Eye', category: 'Search' },
  { name: 'EyeOff', category: 'Search' },
  { name: 'ScanSearch', category: 'Search' },
  { name: 'Globe', category: 'Search' },
  { name: 'Compass', category: 'Search' },

  // Code & Development
  { name: 'Code', category: 'Code' },
  { name: 'CodeXml', category: 'Code' },
  { name: 'Terminal', category: 'Code' },
  { name: 'SquareTerminal', category: 'Code' },
  { name: 'GitBranch', category: 'Code' },
  { name: 'GitCommit', category: 'Code' },
  { name: 'GitMerge', category: 'Code' },
  { name: 'GitPullRequest', category: 'Code' },
  { name: 'Bug', category: 'Code' },
  { name: 'Play', category: 'Code' },
  { name: 'Pause', category: 'Code' },
  { name: 'Square', category: 'Code' },

  // Reading & Education
  { name: 'BookOpen', category: 'Reading' },
  { name: 'Book', category: 'Reading' },
  { name: 'Library', category: 'Reading' },
  { name: 'GraduationCap', category: 'Reading' },
  { name: 'Lightbulb', category: 'Reading' },
  { name: 'BookMarked', category: 'Reading' },

  // Security
  { name: 'Lock', category: 'Security' },
  { name: 'Unlock', category: 'Security' },
  { name: 'Key', category: 'Security' },
  { name: 'Shield', category: 'Security' },
  { name: 'Fingerprint', category: 'Security' },

  // Media & Layout
  { name: 'Image', category: 'Media' },
  { name: 'Camera', category: 'Media' },
  { name: 'Video', category: 'Media' },
  { name: 'Music', category: 'Media' },
  { name: 'Minimize', category: 'Media' },
  { name: 'Maximize', category: 'Media' },
  { name: 'Expand', category: 'Media' },
  { name: 'Shrink', category: 'Media' },

  // Nature & Objects
  { name: 'Sun', category: 'Nature' },
  { name: 'Moon', category: 'Nature' },
  { name: 'Star', category: 'Nature' },
  { name: 'Heart', category: 'Nature' },
  { name: 'ThumbsUp', category: 'Nature' },
  { name: 'ThumbsDown', category: 'Nature' },
  { name: 'Flag', category: 'Nature' },
  { name: 'Pin', category: 'Nature' },
  { name: 'Bookmark', category: 'Nature' },
  { name: 'Tag', category: 'Nature' },

  // Data & Charts
  { name: 'Database', category: 'Data' },
  { name: 'Table', category: 'Data' },
  { name: 'BarChart', category: 'Data' },
  { name: 'LineChart', category: 'Data' },
  { name: 'PieChart', category: 'Data' },
  { name: 'TrendingUp', category: 'Data' },
  { name: 'TrendingDown', category: 'Data' },

  // Connectivity
  { name: 'Wifi', category: 'Connectivity' },
  { name: 'WifiOff', category: 'Connectivity' },
  { name: 'Link', category: 'Connectivity' },
  { name: 'Unlink', category: 'Connectivity' },
  { name: 'Download', category: 'Connectivity' },
  { name: 'Upload', category: 'Connectivity' },
  { name: 'Cloud', category: 'Connectivity' },
  { name: 'Server', category: 'Connectivity' },
  { name: 'Plug', category: 'Connectivity' },
]

/** All unique category names in display order */
export const ICON_CATEGORIES = [...new Set(ICON_CATALOG.map((e) => e.category))]
