// « Le JT Alertiva » — récap vidéo vertical du soir.
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Cue } from "./alertiva-theme";
import { ALERTIVA_FPS, TopBar, NewsSlide, Intro, Outro, SubtitleBar } from "./AlertivaShared";
import { DARK } from "./alertiva-theme";

export const JT_FPS = ALERTIVA_FPS;

export type JTSegment = {
  type: "intro" | "article" | "outro";
  image?: string;
  title?: string;
  category?: string;
  from: number;
  to: number;
};
export type JTProps = {
  durationSec: number;
  audioFile: string;
  date: string;
  segments: JTSegment[];
  cues: Cue[];
};

export const AlertivaJT: React.FC<JTProps> = ({ audioFile, date, segments, cues }) => {
  return (
    <AbsoluteFill style={{ background: DARK }}>
      {segments.map((s, i) => {
        const from = Math.floor(s.from * JT_FPS);
        const duration = Math.max(1, Math.ceil((s.to - s.from) * JT_FPS));
        return (
          <Sequence key={i} from={from} durationInFrames={duration}>
            {s.type === "intro" ? <Intro brandSub="LE JT" date={date} />
              : s.type === "outro" ? <Outro />
              : <NewsSlide image={s.image} title={s.title} category={s.category} index={i} durationFrames={duration} />}
          </Sequence>
        );
      })}
      <TopBar date={date} />
      <SubtitleBar cues={cues} fps={JT_FPS} />
      {audioFile ? <Audio src={staticFile(audioFile)} /> : null}
    </AbsoluteFill>
  );
};
