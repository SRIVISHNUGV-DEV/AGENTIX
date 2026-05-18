import { Button } from '@/components/ui/button';
import Link from 'next/link';

export function IntegrationSection() {
  return (
    <section className="py-24 bg-background">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-border bg-card p-8 sm:p-12">
          <div className="text-center">
            <h2 className="text-4xl sm:text-5xl font-bold text-foreground mb-6 text-balance">
              Get Started in Minutes
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto text-balance">
              Simple REST API and comprehensive documentation for rapid integration into your agent infrastructure.
            </p>

            <div className="bg-secondary/50 rounded-lg p-8 mb-8 text-left font-mono text-sm">
              <div className="text-muted-foreground">
                <div>curl -X POST https://api.primeflow.io/credentials \\</div>
                <div className="ml-4">-H "Authorization: Bearer YOUR_API_KEY" \\</div>
                <div className="ml-4">-d {'{'}</div>
                <div className="ml-8">"name": "uniswap-api",</div>
                <div className="ml-8">"type": "api_key",</div>
                <div className="ml-8">"provider": "uniswap"</div>
                <div className="ml-4">{'}'}</div>
              </div>
            </div>

            <Link href="/integration">
              <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground px-8">
                View Integration Guide
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
