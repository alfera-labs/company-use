export function ProjectSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 p-5 md:grid-cols-[12rem_minmax(0,1fr)]">
      <div>
        <h2 className="font-medium text-sm">{title}</h2>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
