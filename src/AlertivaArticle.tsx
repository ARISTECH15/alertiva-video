// Vidéo verticale dédiée à UN article (format monétisable > 1 min).
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Cue, DARK } from "./alertiva-theme";
import { ALERTIVA_FPS, TopBar, NewsSlide, InfoCard, HeadlineList, Intro, Outro, SubtitleBar } from "./AlertivaShared";

export const ARTICLE_FPS = ALERTIVA_FPS;

export type ArticleSegment =
  | { type: "intro"; from: number; to: number }
  | { type: "article"; image?: string; images?: string[]; title?: string; category?: string; fit?: "cover" | "contain"; from: number; to: number }
  | { type: "card"; image?: string; headline?: string; summary?: string; category?: string; index?: number; total?: number; from: number; to: number }
  | { type: "headlines"; heading?: string; items?: string[]; from: number; to: number }
  | { type: "outro"; from: number; to: number };

export type ArticleProps = {
  durationSec: number;
  audioFile: string;
  date: string;
  category: string;
  segments: ArticleSegment[];
  cues: Cue[];
};

export const AlertivaArticle: React.FC<ArticleProps> = ({ audioFile, date, category, segments, cues }) => {
  return (
    <AbsoluteFill style={{ background: DARK }}>
      {segments.map((s, i) => {
        const from = Math.floor(s.from * ARTICLE_FPS);
        const duration = Math.max(1, Math.ceil((s.to - s.from) * ARTICLE_FPS));
        return (
          <Sequence key={i} from={from} durationInFrames={duration}>
            {s.type === "intro" ? <Intro brandSub={category || "À la une"} date={date} />
              : s.type === "outro" ? <Outro />
              : s.type === "headlines" ? <HeadlineList heading={s.heading || "Aussi à la une"} items={s.items || []} />
              : s.type === "card" ? <InfoCard image={s.image} headline={s.headline} summary={s.summary} category={s.category} index={s.index} total={s.total} durationFrames={duration} />
              : <NewsSlide image={s.image} images={s.images} title={s.title} category={s.category} index={1} durationFrames={duration} fit={s.fit} />}
          </Sequence>
        );
      })}
      <TopBar date={date} />
      {/* Sous-titres live synchronisés (au milieu en portrait), par-dessus les cartes. */}
      <SubtitleBar cues={cues} fps={ARTICLE_FPS} />
      {audioFile ? <Audio src={staticFile(audioFile)} /> : null}
    </AbsoluteFill>
  );
};
