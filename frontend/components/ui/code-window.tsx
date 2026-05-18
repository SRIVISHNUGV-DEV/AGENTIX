"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CodeWindowProps { filename: string; code: string; className?: string; typingEffect?: boolean; }

// Escape HTML special characters to prevent rendering during typing
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Apply syntax highlighting to code
function highlightCode(code: string): string {
  return code
    .replace(/&lt;(\/?)([a-zA-Z][a-zA-Z0-9]*)(&gt;|\s)/g, '&lt;$1<span class="text-pink-400">$2</span>$3') // HTML tags
    .replace(/(\/\/.*$)/gm, '<span class="text-zinc-500">$1</span>') // Comments
    .replace(/\b(import|from|const|let|var|function|class|export|default|return|await|async|if|else|for|while|try|catch|new|this|typeof|instanceof)\b/g, '<span class="text-purple-400">$1</span>') // Keywords
    .replace(/\b(true|false|null|undefined)\b/g, '<span class="text-orange-400">$1</span>') // Booleans/null
    .replace(/(&#039;.*?&#039;|&quot;.*?&quot;|`.*?`)/g, '<span class="text-green-400">$1</span>') // Strings
    .replace(/\b(\d+)\b/g, '<span class="text-orange-400">$1</span>') // Numbers
    .replace(/\b([A-Z][a-zA-Z0-9]*)\b/g, '<span class="text-yellow-400">$1</span>') // Class names
    .replace(/\b([a-z][a-zA-Z0-9]*)\s*(?=\()/g, '<span class="text-blue-400">$1</span>'); // Function calls
}

export function CodeWindow({ filename, code, className, typingEffect = true }: CodeWindowProps) {
  const [displayedCode, setDisplayedCode] = useState(typingEffect ? "" : code);
  const [isComplete, setIsComplete] = useState(!typingEffect);

  useEffect(() => {
    if (!typingEffect) {
      setDisplayedCode(code);
      setIsComplete(true);
      return;
    }
    let index = 0;
    const timer = setInterval(() => {
      if (index <= code.length) {
        setDisplayedCode(code.slice(0, index));
        index++;
      } else {
        clearInterval(timer);
        setIsComplete(true);
      }
    }, 15);
    return () => clearInterval(timer);
  }, [code, typingEffect]);

  // Only highlight after typing is complete to avoid showing raw HTML
  const displayHtml = isComplete ? highlightCode(escapeHtml(code)) : escapeHtml(displayedCode);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className={cn("rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 font-mono text-sm", className)}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <div className="w-3 h-3 rounded-full bg-red-500/20" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/20" />
        <div className="w-3 h-3 rounded-full bg-green-500/20" />
        <span className="ml-4 text-xs text-zinc-600">{filename}</span>
      </div>
      <div className="p-4 overflow-x-auto">
        <pre className="text-zinc-300 leading-relaxed">
          <code dangerouslySetInnerHTML={{ __html: displayHtml }} />
          {!isComplete && <span className="inline-block w-2 h-4 bg-zinc-500 ml-0.5 animate-pulse" />}
        </pre>
      </div>
    </motion.div>
  );
}
