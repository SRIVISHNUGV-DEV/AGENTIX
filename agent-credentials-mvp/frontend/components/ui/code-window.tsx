"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CodeWindowProps { filename: string; code: string; className?: string; typingEffect?: boolean; }

export function CodeWindow({ filename, code, className, typingEffect = true }: CodeWindowProps) {
  const [displayedCode, setDisplayedCode] = useState(typingEffect ? "" : code);

  useEffect(() => {
    if (!typingEffect) return;
    let index = 0;
    const timer = setInterval(() => {
      if (index <= code.length) { setDisplayedCode(code.slice(0, index)); index++; }
      else { clearInterval(timer); }
    }, 15);
    return () => clearInterval(timer);
  }, [code, typingEffect]);

  const highlighted = displayedCode
    .replace(/(\/\/.*$)/gm, '<span class="text-zinc-500">$1</span>')
    .replace(/\b(import|from|const|await|return)\b/g, '<span class="text-purple-400">$1</span>')
    .replace(/\b(true|false|null|undefined)\b/g, '<span class="text-orange-400">$1</span>')
    .replace(/('.*?'|".*?"|`.*?`)/g, '<span class="text-green-400">$1</span>')
    .replace(/\b(\d+)\b/g, '<span class="text-orange-400">$1</span>')
    .replace(/\b([A-Z][a-zA-Z0-9]*)\b/g, '<span class="text-yellow-400">$1</span>')
    .replace(/\b([a-z][a-zA-Z0-9]*)\s*(?=\()/g, '<span class="text-blue-400">$1</span>');

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className={cn("rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 font-mono text-sm", className)}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <div className="w-3 h-3 rounded-full bg-red-500/20" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/20" />
        <div className="w-3 h-3 rounded-full bg-green-500/20" />
        <span className="ml-4 text-xs text-zinc-600">{filename}</span>
      </div>
      <div className="p-4 overflow-x-auto">
        <pre className="text-zinc-300 leading-relaxed"><code dangerouslySetInnerHTML={{ __html: highlighted }} />
          {typingEffect && displayedCode.length < code.length && <span className="inline-block w-2 h-4 bg-zinc-500 ml-0.5 animate-pulse" />}
        </pre>
      </div>
    </motion.div>
  );
}
