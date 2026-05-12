'use client'

import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface CodeBlockProps {
  code: string
  language?: string
  filename?: string
}

export function CodeBlock({ code, language = 'typescript', filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-border bg-muted overflow-hidden">
      {(filename || language) && (
        <div className="flex items-center justify-between bg-muted-foreground/10 px-4 py-2 border-b border-border">
          <span className="text-xs font-mono text-muted-foreground">
            {filename || language}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-6 w-6 p-0"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}
      <pre className="overflow-x-auto p-4">
        <code className={`font-mono text-sm text-foreground language-${language}`}>
          {code}
        </code>
      </pre>
    </div>
  )
}
