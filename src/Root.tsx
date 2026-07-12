import { Composition, staticFile } from "remotion";
import { AlertivaJT, JTProps, JT_FPS } from "./AlertivaJT";
import { AlertivaArticle, ArticleProps, ARTICLE_FPS } from "./AlertivaArticle";

const defaultJTProps: JTProps = {
  durationSec: 10, audioFile: "", date: "", segments: [{ type: "intro", from: 0, to: 10 }], cues: [],
};

const defaultArticleProps: ArticleProps = {
  durationSec: 10, audioFile: "", date: "", category: "", segments: [{ type: "intro", from: 0, to: 10 }], cues: [],
};

// Au studio (props par défaut), tente de charger le dernier props.json généré ;
// sinon garde les défauts. Renvoie toujours un entier valide.
async function metaFrom<T extends { durationSec: number; audioFile: string }>(
  props: T, workFile: string, fps: number,
) {
  let p: T = props;
  if (!props.audioFile) {
    try {
      const res = await fetch(staticFile(workFile));
      if (res.ok) {
        const j = (await res.json()) as T;
        if (j && Number(j.durationSec) > 0) p = j;
      }
    } catch { /* défauts */ }
  }
  const d = Number(p.durationSec) || 10;
  return { durationInFrames: Math.max(1, Math.ceil(d * fps)), props: p };
}

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AlertivaArticle"
        component={AlertivaArticle}
        width={1080}
        height={1920}
        fps={ARTICLE_FPS}
        defaultProps={defaultArticleProps}
        calculateMetadata={({ props }) => metaFrom(props, "work-article/props.json", ARTICLE_FPS)}
      />
      <Composition
        id="AlertivaJT"
        component={AlertivaJT}
        width={1080}
        height={1920}
        fps={JT_FPS}
        defaultProps={defaultJTProps}
        calculateMetadata={({ props }) => metaFrom(props, "work-jt/props.json", JT_FPS)}
      />
    </>
  );
};
