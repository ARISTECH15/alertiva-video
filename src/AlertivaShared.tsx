// Briques visuelles communes au JT du soir et aux vidéos par article.
// Règle clé : le TITRE vit dans la moitié HAUTE, les SOUS-TITRES tout en BAS
// -> ils ne se chevauchent jamais (demande de Farid).
import {
  AbsoluteFill, Img, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig,
} from "remotion";
import { SERIF, SANS, ALERT, DARK, CREAM, Cue } from "./alertiva-theme";

export const ALERTIVA_FPS = 30;

const resolveSrc = (s?: string) => (!s ? undefined : s.startsWith("http") ? s : staticFile(s));

/** Bandeau chaîne info permanent en haut. */
export const TopBar: React.FC<{ date?: string }> = ({ date }) => (
  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 92,
    background: DARK, display: "flex", alignItems: "center", padding: "0 30px", gap: 14, zIndex: 5 }}>
    <span style={{ width: 16, height: 16, borderRadius: "50%", background: ALERT }} />
    <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 40, color: "#fff", letterSpacing: 1 }}>
      ALERTIVA <span style={{ color: ALERT }}>NEWS</span>
    </span>
    {date && <span style={{ marginLeft: "auto", fontFamily: SANS, fontSize: 26, color: "#aaa" }}>{date}</span>}
  </div>
);

/**
 * Plan article : image nette plein cadre (léger Ken Burns) + badge rubrique
 * et TITRE dans la zone haute. Le bas reste dégagé pour les sous-titres.
 */
export const NewsSlide: React.FC<{
  image?: string; title?: string; category?: string; index?: number; durationFrames: number;
}> = ({ image, title, category, index = 0, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoomIn = index % 2 === 0;
  const scale = interpolate(frame, [0, durationFrames], zoomIn ? [1.06, 1.18] : [1.18, 1.06], { extrapolateRight: "clamp" });
  const appear = spring({ frame, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      {image && (
        <Img src={resolveSrc(image)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} />
      )}
      {/* Voile : sombre en haut (lisibilité titre) + sombre en bas (lisibilité sous-titres) */}
      <AbsoluteFill style={{ background:
        "linear-gradient(180deg, rgba(13,13,20,0.88) 0%, rgba(13,13,20,0.45) 24%, transparent 44%, transparent 60%, rgba(13,13,20,0.55) 100%)" }} />
      {/* Bloc titre — zone HAUTE */}
      <div style={{ position: "absolute", top: 150, left: 0, right: 0, padding: "0 46px",
        opacity: appear, transform: `translateY(${(1 - appear) * -18}px)` }}>
        {category && (
          <span style={{ background: ALERT, color: "#fff", fontFamily: SANS, fontWeight: 800, fontSize: 34,
            padding: "8px 22px", borderRadius: 8, textTransform: "uppercase", letterSpacing: 2 }}>
            {category}
          </span>
        )}
        {title && (
          <div style={{ marginTop: 20, fontFamily: SERIF, fontWeight: 900, fontSize: 68, lineHeight: 1.12,
            color: "#fff", textShadow: "0 3px 26px rgba(0,0,0,0.95)" }}>
            {title}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** Slide « Aussi à la une » : rappel de quelques autres titres (cross-promo). */
export const HeadlineList: React.FC<{ heading: string; items: string[] }> = ({ heading, items }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: DARK, justifyContent: "center", padding: "0 60px" }}>
      <div style={{ position: "absolute", width: 1200, height: 1200, top: -200, right: -300, borderRadius: "50%",
        background: `radial-gradient(circle, ${ALERT}18, transparent 60%)` }} />
      <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 40, color: ALERT, letterSpacing: 3,
        textTransform: "uppercase", marginBottom: 40 }}>Aussi à la une</div>
      {items.slice(0, 4).map((h, i) => {
        const s = spring({ frame: frame - i * 6, fps, config: { damping: 16 } });
        return (
          <div key={i} style={{ display: "flex", gap: 22, alignItems: "flex-start", marginBottom: 34,
            opacity: s, transform: `translateX(${(1 - s) * 40}px)` }}>
            <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 54, color: ALERT, lineHeight: 1 }}>{i + 1}</span>
            <span style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 50, color: "#fff", lineHeight: 1.18 }}>{h}</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** Ouverture animée. brandSub = « LE JT » (soir) ou la rubrique (article). */
export const Intro: React.FC<{ brandSub: string; date?: string }> = ({ brandSub, date }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ background: DARK, justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "absolute", width: 1300, height: 1300, borderRadius: "50%",
        background: `radial-gradient(circle, ${ALERT}22, transparent 65%)` }} />
      <div style={{ transform: `scale(${s})`, textAlign: "center", padding: "0 40px" }}>
        <div style={{ fontFamily: SERIF, fontSize: 118, fontWeight: 900, color: "#fff", letterSpacing: 4, lineHeight: 1.05 }}>
          ALERTIVA<span style={{ color: ALERT }}>NEWS</span>
        </div>
        <div style={{ marginTop: 22, background: ALERT, color: "#fff", display: "inline-block",
          fontFamily: SANS, fontWeight: 800, fontSize: 46, padding: "12px 38px", borderRadius: 12,
          letterSpacing: 3, textTransform: "uppercase" }}>
          {brandSub}
        </div>
        {date && <div style={{ marginTop: 28, fontFamily: SANS, fontSize: 38, color: "#bbb" }}>{date}</div>}
      </div>
    </AbsoluteFill>
  );
};

/** Clôture : incitation à s'abonner ET à partager (demande de Farid). */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 12 } });
  const pulse = 1 + 0.03 * Math.sin((frame / fps) * Math.PI * 2);
  return (
    <AbsoluteFill style={{ background: DARK, justifyContent: "center", alignItems: "center", padding: "0 50px" }}>
      <div style={{ transform: `scale(${s})`, textAlign: "center", fontFamily: SERIF, fontSize: 104, fontWeight: 900,
        color: "#fff", letterSpacing: 3, lineHeight: 1.05 }}>
        ALERTIVA<span style={{ color: ALERT }}>NEWS</span>
      </div>
      {/* CTA abonne-toi + partage */}
      <div style={{ marginTop: 46, display: "flex", gap: 26 }}>
        <span style={{ background: "#fff", color: DARK, fontFamily: SANS, fontWeight: 800, fontSize: 44,
          padding: "18px 34px", borderRadius: 16 }}>🔔 Abonne-toi</span>
        <span style={{ background: ALERT, color: "#fff", fontFamily: SANS, fontWeight: 800, fontSize: 44,
          padding: "18px 34px", borderRadius: 16 }}>📲 Partage</span>
      </div>
      <div style={{ marginTop: 40, transform: `scale(${pulse})`, background: "transparent", color: CREAM,
        border: `3px solid ${ALERT}`, fontFamily: SANS, fontWeight: 800, fontSize: 46, padding: "20px 44px", borderRadius: 60 }}>
        alertivanews.com
      </div>
      <div style={{ marginTop: 30, fontFamily: SANS, fontSize: 34, color: "#bbb", textAlign: "center" }}>
        TikTok @alertiva · YouTube @ALERTIVANEWS
      </div>
    </AbsoluteFill>
  );
};

/** Sous-titres synchronisés, ancrés tout en BAS (jamais sur le titre). */
export const SubtitleBar: React.FC<{ cues: Cue[]; fps?: number }> = ({ cues, fps = ALERTIVA_FPS }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height >= width; // vertical (TikTok) vs paysage (YouTube)
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.start && t <= c.end + 0.15);
  if (!cue) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", zIndex: 8 }}>
      <div style={{ marginBottom: portrait ? 232 : 64, maxWidth: portrait ? 940 : 1400, textAlign: "center", background: "rgba(13,13,20,0.82)",
        borderRadius: 16, padding: "16px 30px", fontFamily: SANS, fontWeight: 700, fontSize: 46, lineHeight: 1.28,
        color: "#fff", boxShadow: "0 6px 30px rgba(0,0,0,0.45)" }}>
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};
