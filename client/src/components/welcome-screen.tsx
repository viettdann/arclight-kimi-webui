const features = [
  {
    image: '/showcase/web-reading.png',
    title: 'Web Reading',
    description: 'Read and summarize any web page in real time.',
  },
  {
    image: '/showcase/research-analysis.png',
    title: 'Research and Analysis',
    description: 'Structured deep-dives into any topic.',
  },
  {
    image: '/showcase/data-mining.png',
    title: 'Data Mining',
    description: 'Find patterns across large datasets.',
  },
  {
    image: '/showcase/content-creation.png',
    title: 'Content Creation',
    description: 'Draft, edit, and polish with AI.',
  },
];

export function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center px-6 pt-10 pb-6">
      <div className="max-w-3xl text-center">
        <div className="flex items-center justify-center gap-3">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            <span className="text-foreground">More Than </span>
            <span className="gradient-text">Code</span>
          </h1>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            BETA
          </span>
        </div>
        <p className="mt-4 text-base text-muted-foreground">
          Your AI-powered workspace for research, analysis, and creation.
        </p>
      </div>

      <div className="mt-10 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="flex min-h-[176px] flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/30 hover:bg-accent cursor-default"
          >
            <img
              src={feature.image}
              alt={feature.title}
              className="h-12 w-12 object-contain"
              loading="lazy"
            />
            <h3 className="mt-5 text-sm font-semibold">{feature.title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
