import { Database, Globe, PenTool, Search } from 'lucide-react';

const features = [
  {
    icon: Globe,
    title: 'Web Reading',
    description: 'Browse and extract insights from any web page in real time.',
  },
  {
    icon: Search,
    title: 'Research and Analysis',
    description: 'Deep-dive into topics with structured research workflows.',
  },
  {
    icon: Database,
    title: 'Data Mining',
    description: 'Discover patterns and extract value from large datasets.',
  },
  {
    icon: PenTool,
    title: 'Content Creation',
    description: 'Draft, edit, and polish content with AI assistance.',
  },
];

export function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-6 md:py-12">
      <div className="max-w-3xl text-center">
        <div className="flex items-center justify-center gap-3">
          <h1 className="text-4xl font-bold tracking-tight gradient-text">More Than Coding</h1>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            BETA
          </span>
        </div>
        <p className="mt-3 text-base text-muted-foreground">
          Your AI-powered workspace for research, analysis, and creation.
        </p>
      </div>

      <div className="mt-10 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-md cursor-default"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <feature.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-3 text-sm font-semibold">{feature.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
