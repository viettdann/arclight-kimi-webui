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
    <div className="flex flex-col items-center px-4 py-6 md:px-6 md:py-10">
      <div className="max-w-3xl text-center">
        <div className="flex items-center justify-center gap-2 md:gap-3">
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
            <span className="text-foreground">More Than </span>
            <span className="gradient-text">Code</span>
          </h1>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            BETA
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground md:mt-4 md:text-base">
          Your AI-powered workspace for research, analysis, and creation.
        </p>
      </div>

      {/* Mobile: compact horizontal rows (icon left, text right) so all four
          cards stack without overflowing the viewport and the composer below
          stays reachable. Desktop (sm+): the taller vertical-card grid. */}
      <div className="mt-6 grid w-full max-w-4xl grid-cols-1 gap-2.5 sm:mt-10 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="flex flex-row items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-accent cursor-default sm:min-h-[176px] sm:flex-col sm:items-start sm:gap-0 sm:p-6"
          >
            <img
              src={feature.image}
              alt={feature.title}
              className="h-9 w-9 shrink-0 object-contain sm:h-12 sm:w-12"
              loading="lazy"
            />
            <div className="min-w-0 sm:contents">
              <h3 className="text-sm font-semibold sm:mt-5">{feature.title}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:mt-2">
                {feature.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
