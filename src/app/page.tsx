import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-accent-text">
        PPM Platform
      </p>
      <h1 className="max-w-xl font-display text-4xl font-semibold text-foreground">
        Facility maintenance, built for the Gulf.
      </h1>
      <p className="max-w-md text-base text-muted-foreground">
        The application shell is under construction. Review the design system and
        component kit in the style guide.
      </p>
      <Link href="/style-guide">
        <Button size="lg">Open the style guide</Button>
      </Link>
    </main>
  );
}
