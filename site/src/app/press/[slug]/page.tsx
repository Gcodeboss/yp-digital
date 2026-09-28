import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import {
  PRESS_ARTICLES,
  pressArticleBySlug,
  formatDate,
  type PressBlock,
} from "@/lib/content";
import { ArticleJsonLd } from "@/components/structured-data";

export function generateStaticParams() {
  return PRESS_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = pressArticleBySlug(slug);
  if (!article) return { title: "Press" };
  return {
    title: `${article.title} · ${article.outlet}`,
    description: article.deck,
    alternates: { canonical: `/press/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.deck,
      type: "article",
      images: [{ url: article.image }],
    },
  };
}

function Block({ block }: { block: PressBlock }) {
  if (block.type === "h") {
    return (
      <h2 className="mt-12 font-display text-[clamp(1.5rem,3.5vw,2.2rem)] uppercase leading-[0.98] text-cream">
        {block.text}
      </h2>
    );
  }
  if (block.type === "quote") {
    return (
      <blockquote className="my-10 border-l-2 border-amber pl-6">
        <p className="font-display text-[clamp(1.5rem,3.5vw,2.4rem)] uppercase leading-[1.05] text-cream">
          &ldquo;{block.text}&rdquo;
        </p>
        {block.cite && (
          <cite className="mt-4 block font-mono text-[0.7rem] uppercase not-italic tracking-[0.2em] text-amber">
            {block.cite}
          </cite>
        )}
      </blockquote>
    );
  }
  return (
    <p className="mt-6 text-lg leading-[1.75] text-cream/85">{block.text}</p>
  );
}

export default async function PressArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = pressArticleBySlug(slug);
  if (!article) notFound();

  const more = PRESS_ARTICLES.filter((a) => a.slug !== article.slug).slice(
    0,
    3,
  );

  return (
    <>
      <ArticleJsonLd
        title={article.title}
        deck={article.deck}
        slug={article.slug}
        outlet={article.outlet}
        date={article.date}
        image={article.image}
      />
    <article className="px-5 pb-24 pt-28 sm:px-8 sm:pt-32">
      <div className="mx-auto w-full max-w-[820px]">
        <Link
          href="/press"
          className="inline-flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-warmgray transition-colors hover:text-amber"
        >
          <ArrowLeft size={14} /> All press
        </Link>

        {/* Kicker */}
        <div className="mt-8 flex flex-wrap items-center gap-3 font-mono text-[0.7rem] uppercase tracking-[0.2em]">
          <span className="bg-amber px-2.5 py-1 font-bold text-void">
            {article.outlet}
          </span>
          <span className="text-warmgray">{article.category}</span>
          <span className="text-warmgray">·</span>
          <span className="text-warmgray">{formatDate(article.date)}</span>
          <span className="text-warmgray">·</span>
          <span className="text-warmgray">{article.readMins} min read</span>
        </div>

        {/* Headline + deck */}
        <h1 className="mt-5 font-display text-[clamp(2.2rem,6vw,4.2rem)] uppercase leading-[0.9] text-cream">
          {article.title}
        </h1>
        <p className="mt-6 text-xl leading-relaxed text-warmgray sm:text-2xl">
          {article.deck}
        </p>
      </div>

      {/* Hero image */}
      <figure className="mx-auto mt-10 w-full max-w-[1100px]">
        <div className="relative aspect-[16/9] overflow-hidden bg-coal">
          <Image
            src={article.image}
            alt={article.title}
            fill
            priority
            sizes="(max-width:1100px) 100vw, 1100px"
            className="object-contain"
          />
        </div>
        {article.imageCredit && (
          <figcaption className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-warmgray">
            Photo · {article.imageCredit}
          </figcaption>
        )}
      </figure>

      {/* Body */}
      <div className="mx-auto mt-12 w-full max-w-[680px]">
        {article.body.map((block, i) => (
          <Block key={i} block={block} />
        ))}

        {/* Source line */}
        {article.externalUrl && (
          <div className="mt-14 border-t border-white/10 pt-6">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-warmgray">
              Originally featured in {article.outlet}
            </p>
            <a
              href={article.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 font-head text-sm font-bold uppercase tracking-[0.08em] text-amber transition-colors hover:text-gold"
            >
              Read on {article.outlet} <ArrowUpRight size={15} />
            </a>
          </div>
        )}
      </div>

      {/* More press */}
      <div className="mx-auto mt-20 w-full max-w-[1100px] border-t border-white/10 pt-10">
        <h2 className="mb-8 font-head text-sm font-bold uppercase tracking-[0.2em] text-cream">
          More coverage
        </h2>
        <div className="grid gap-x-7 gap-y-10 sm:grid-cols-3">
          {more.map((a) => (
            <Link
              key={a.slug}
              href={`/press/${a.slug}`}
              className="group flex flex-col"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-coal">
                <Image
                  src={a.image}
                  alt={a.title}
                  fill
                  sizes="(max-width:640px) 100vw, 360px"
                  className="object-contain transition-transform duration-700 group-hover:scale-[1.04]"
                />
              </div>
              <span className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
                {a.outlet}
              </span>
              <h3 className="mt-2 font-display text-[1.4rem] uppercase leading-[1] text-cream transition-colors group-hover:text-amber">
                {a.title}
              </h3>
            </Link>
          ))}
        </div>
      </div>
    </article>
    </>
  );
}
